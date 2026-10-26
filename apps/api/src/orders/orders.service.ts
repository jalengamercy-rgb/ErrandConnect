import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  CASH_DEBT_LIMIT,
  DEFAULT_MERCHANT_COMMISSION_RATE,
  CUSTOMER_CANCELLABLE_STATUSES,
  DEFAULT_JOB_RADIUS_KM,
  ORDER_LIMIT_BY_LEVEL,
  RUNNER_ACTIVE_STATUSES,
  RUNNER_RELEASABLE_STATUSES,
  calculateQuote,
  estimateRoadKm,
  haversineKm,
  isForwardMove,
  type RunnerProgressStatus,
} from '@errandconnect/shared';
import type { AuthUser } from '../common/auth-user.js';
import { randomDigits } from '../common/crypto.js';
import { uniqueCode } from '../common/codes.js';
import { OrderStatus, Prisma, type Address, type Order } from '../generated/prisma/client.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { DispatchService, jobStart } from '../realtime/dispatch.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { recalculateRunnerRating } from './ratings.js';
import { PromoError, PromosService } from '../growth/promos.service.js';
import { RewardsService } from '../growth/rewards.service.js';
import { SubscriptionsService } from '../growth/subscriptions.service.js';
import { SurgeService } from '../growth/surge.service.js';
import { PredictionsService } from '../insights/predictions.service.js';
import { RiskService } from '../insights/risk.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import type { CreateOrderDto, LocationDto, OrderDetailsDto, ReviewDto } from './orders.dto.js';

const MAX_ACTIVE_ORDERS_PER_CUSTOMER = 5;
const MAX_PIN_ATTEMPTS = 5;
/** Chat stays open this long after an order ends, for follow-up questions. */
const CHAT_GRACE_MS = 24 * 60 * 60_000;

const PERSON = { id: true, firstName: true, lastName: true, photoUrl: true, phone: true } as const;

const ORDER_INCLUDE = {
  category: { select: { name: true } },
  customer: { select: PERSON },
  runner: {
    select: {
      ...PERSON,
      runnerProfile: {
        select: {
          ratingAvg: true,
          ratingCount: true,
          jobsCompleted: true,
          lastLat: true,
          lastLng: true,
          lastSeenAt: true,
          vehicles: { select: { type: true, registrationNumber: true, make: true, model: true, color: true } },
        },
      },
    },
  },
  events: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, createdAt: true } },
  reviews: { select: { authorId: true, stars: true, comment: true } },
  escrow: { select: { status: true } },
  business: { select: { id: true, name: true } },
  merchant: { select: { id: true, name: true, phone: true, addressLine: true } },
  payments: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, failureReason: true, providerReceipt: true, phone: true, createdAt: true },
  },
} satisfies Prisma.OrderInclude;

type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function describeAddress(a: Address): string {
  const parts = [a.unit && a.building ? `${a.unit}, ${a.building}` : a.building, a.street, a.area, a.city].filter(Boolean);
  return parts.length ? parts.join(', ') : `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly realtime: RealtimeService,
    private readonly dispatch: DispatchService,
    private readonly payments: PaymentsService,
    private readonly inbox: InboxService,
    private readonly surge: SurgeService,
    private readonly subscriptions: SubscriptionsService,
    private readonly promos: PromosService,
    private readonly rewards: RewardsService,
    private readonly risk: RiskService,
    private readonly predictions: PredictionsService,
  ) {}

  private readonly logger = new Logger('Orders');

  // ─── Pricing & creation (customers) ───

  private async resolveDropoff(customerId: string, dto: OrderDetailsDto): Promise<LocationDto> {
    if (dto.dropoffAddressId) {
      // A personal saved address, or one of the company's branches for business orders.
      const address = await this.prisma.address.findFirst({
        where: { id: dto.dropoffAddressId, OR: [{ userId: customerId }, ...(dto.businessId ? [{ businessId: dto.businessId }] : [])] },
      });
      if (!address) throw new NotFoundException('Saved address not found');
      return { address: describeAddress(address), lat: address.lat, lng: address.lng, label: address.label };
    }
    if (!dto.dropoff) throw new BadRequestException('Choose where the errand should be delivered');
    return dto.dropoff;
  }

  async quote(customerId: string, dto: OrderDetailsDto) {
    const category = await this.prisma.serviceCategory.findFirst({ where: { slug: dto.categorySlug, isActive: true } });
    if (!category) throw new BadRequestException('Unknown errand type');
    const dropoff = await this.resolveDropoff(customerId, dto);
    const merchant = dto.merchantId ? await this.prisma.merchant.findFirst({ where: { id: dto.merchantId, status: 'ACTIVE' } }) : null;
    if (dto.merchantId && (!merchant || merchant.lat == null || merchant.lng == null))
      throw new BadRequestException('This shop is not available');
    const pickup: LocationDto | undefined = merchant
      ? {
          address: [merchant.name, merchant.addressLine].filter(Boolean).join(', '),
          lat: merchant.lat!,
          lng: merchant.lng!,
          label: merchant.name,
        }
      : dto.pickup;
    // Without a pickup point the runner starts near the customer; the base fee covers that.
    const distanceKm = pickup ? estimateRoadKm(pickup, dropoff) : 0;
    const config = await this.pricing.getConfig();
    // Surge is measured where the runner starts the errand.
    const surge = await this.surge.multiplierAt(pickup ?? dropoff, config.surge);
    // Plus is a personal membership: company errands still pay the service fee.
    const plus = !dto.businessId && (await this.subscriptions.isPlus(customerId));
    const input = {
      itemsCost: dto.itemsCost ?? 0,
      errandFee: category.baseFee,
      distanceKm,
      deliveryType: dto.deliveryType,
      urgency: dto.urgency,
      surgeMultiplier: surge.multiplier,
      waiveServiceFee: plus,
    };
    let quote = calculateQuote(input, config);

    let promo: { code: string; discount: number; promoId?: string; error?: string } | null = null;
    if (dto.promoCode?.trim()) {
      const code = dto.promoCode.trim().toUpperCase();
      try {
        if (dto.businessId) throw new PromoError('Promo codes are for personal errands');
        const result = await this.promos.evaluate(customerId, code, quote.customer.total, quote.customer.total - quote.customer.itemsCost);
        quote = calculateQuote({ ...input, discount: result.discount }, config);
        promo = { code, discount: quote.customer.discount, promoId: result.promo.id };
      } catch (error) {
        if (!(error instanceof PromoError)) throw error;
        promo = { code, discount: 0, error: error.message };
      }
    }
    return { category, dropoff, pickup, merchant, distanceKm, quote, config, promo, plus };
  }

  async create(customerId: string, dto: CreateOrderDto) {
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (
      scheduledFor &&
      (scheduledFor.getTime() < Date.now() + 15 * 60_000 || scheduledFor.getTime() > Date.now() + 14 * 24 * 60 * 60_000)
    ) {
      throw new BadRequestException('Schedule between 15 minutes and 14 days from now');
    }

    const { category, dropoff, pickup, merchant, distanceKm, quote, config, promo } = await this.quote(customerId, dto);
    if (promo?.error) throw new BadRequestException(promo.error);
    const method = dto.paymentMethod;

    // Company orders: the person must be a member of an active business.
    const membership = dto.businessId
      ? await this.prisma.businessMember.findUnique({
          where: { businessId_userId: { businessId: dto.businessId, userId: customerId } },
          include: { business: true },
        })
      : null;
    if (dto.businessId && (!membership || membership.business.status !== 'ACTIVE')) {
      throw new ForbiddenException('You are not a member of this company account, or it is not active yet');
    }
    if (method === 'BUSINESS_INVOICE' && !membership?.business.monthlyInvoicing) {
      throw new BadRequestException('Paying by invoice needs an approved company account with monthly invoicing');
    }

    if (!membership) {
      // Personal orders are limited by the customer's verification level and number of open errands.
      const profile = await this.prisma.customerProfile.findUniqueOrThrow({
        where: { userId: customerId },
        select: { verificationLevel: true },
      });
      const limit = ORDER_LIMIT_BY_LEVEL[profile.verificationLevel];
      if (limit !== null && limit !== undefined && quote.customer.total > limit) {
        throw new ForbiddenException(
          `Orders above KES ${limit.toLocaleString('en-KE')} need a higher verification level. Verify your ${profile.verificationLevel === 1 ? 'email' : 'ID'} to continue.`,
        );
      }
      const active = await this.prisma.order.count({
        where: { customerId, businessId: null, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      });
      if (active >= MAX_ACTIVE_ORDERS_PER_CUSTOMER) {
        throw new ConflictException(`You can have up to ${MAX_ACTIVE_ORDERS_PER_CUSTOMER} active errands at a time`);
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = await uniqueCode(
      () => `EC-${today}-${randomDigits(5)}`,
      async (code) => !!(await this.prisma.order.findUnique({ where: { orderNumber: code }, select: { id: true } })),
    );

    const data = {
      orderNumber,
      customerId,
      businessId: membership?.businessId,
      merchantId: merchant?.id,
      merchantCommission: merchant
        ? Math.round(quote.customer.itemsCost * (merchant.commissionRate ?? DEFAULT_MERCHANT_COMMISSION_RATE))
        : 0,
      categorySlug: category.slug,
      description: dto.description,
      deliveryType: dto.deliveryType,
      urgency: dto.urgency ?? 'STANDARD',
      scheduledFor,
      pickupLabel: pickup?.label,
      pickupAddress: pickup?.address,
      pickupLat: pickup?.lat,
      pickupLng: pickup?.lng,
      dropoffLabel: dropoff.label,
      dropoffAddress: dropoff.address,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      recipientName: dto.recipientName,
      recipientPhone: dto.recipientPhone,
      distanceKm,
      itemsCost: quote.customer.itemsCost,
      errandFee: quote.customer.errandFee,
      deliveryFee: quote.customer.deliveryFee,
      urgencyFee: quote.customer.urgencyFee,
      serviceFee: quote.customer.serviceFee,
      surgeFee: quote.customer.surgeFee,
      discount: quote.customer.discount,
      total: quote.customer.total,
      runnerEarnings: quote.runner.total,
      platformFee: quote.platform.total,
      pricingSnapshot: { quote, config } as unknown as Prisma.InputJsonValue,
      paymentMethod: method,
      deliveryPin: randomDigits(4),
      promoRedemption: promo?.promoId
        ? { create: { promoId: promo.promoId, userId: customerId, amount: quote.customer.discount } }
        : undefined,
    } satisfies Omit<Prisma.OrderUncheckedCreateInput, 'status'>;

    if (method === 'MPESA') {
      // Hidden from runners until M-Pesa confirms the payment.
      const order = await this.prisma.order.create({
        data: {
          ...data,
          status: 'AWAITING_PAYMENT',
          events: { create: { status: 'AWAITING_PAYMENT', actorId: customerId, note: 'Waiting for M-Pesa payment' } },
        },
      });
      const phone =
        dto.mpesaPhone ?? (await this.prisma.user.findUniqueOrThrow({ where: { id: customerId }, select: { phone: true } })).phone;
      // If the prompt can't be sent, the order stays unpaid and the customer can retry.
      const paymentRequest = await this.payments
        .requestMpesaPayment(order, phone)
        .catch((error: Error) => ({ requested: false, message: error.message }));
      await this.checkNewOrder(order);
      return { ...(await this.getForViewer(order.id, { id: customerId, staffRole: null })), paymentRequest };
    }

    // Members' company orders above their limit wait for an owner or admin.
    if (
      method === 'BUSINESS_INVOICE' &&
      membership?.role === 'MEMBER' &&
      membership.approvalLimit !== null &&
      quote.customer.total > membership.approvalLimit
    ) {
      const order = await this.prisma.order.create({
        data: {
          ...data,
          status: 'PENDING_APPROVAL',
          events: { create: { status: 'PENDING_APPROVAL', actorId: customerId, note: 'Waiting for company approval' } },
        },
      });
      const approvers = await this.prisma.businessMember.findMany({
        where: { businessId: membership.businessId, role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true },
      });
      await this.inbox.notify(
        approvers.map((a) => a.userId),
        {
          title: 'Errand needs your approval',
          body: `${order.orderNumber}: ${order.description.slice(0, 120)}`,
          link: `/orders/${order.id}`,
        },
      );
      return this.getForViewer(order.id, { id: customerId, staffRole: null });
    }

    const notes: Record<string, string> = {
      WALLET: 'Errand posted · paid from wallet',
      CASH: 'Errand posted · cash on delivery',
      BUSINESS_INVOICE: `Errand posted · billed to ${membership?.business.name}`,
    };
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          ...data,
          status: 'PENDING',
          paidAt: method === 'WALLET' || method === 'BUSINESS_INVOICE' ? new Date() : null,
          events: { create: { status: 'PENDING', actorId: customerId, note: notes[method] } },
        },
      });
      if (method === 'WALLET') await this.payments.holdFromWallet(tx, created);
      if (method === 'BUSINESS_INVOICE') await this.payments.holdFromBusinessCredit(tx, created, membership!.business.creditLimit);
      return created;
    });

    await this.dispatch.newJob(order);
    await this.checkNewOrder(order);
    return this.getForViewer(order.id, { id: customerId, staffRole: null });
  }

  /** Risk checks never stop an order from being placed. */
  private async checkNewOrder(order: Order) {
    await this.risk.onOrderCreated(order).catch((error: Error) => this.logger.error(`Risk check failed: ${error.message}`));
  }

  // ─── Company approvals ───

  private async approverFor(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { business: true } });
    if (!order?.businessId) throw new NotFoundException('Order not found');
    const member = await this.prisma.businessMember.findUnique({ where: { businessId_userId: { businessId: order.businessId, userId } } });
    if (!member || member.role === 'MEMBER') throw new ForbiddenException('Only company owners and admins can approve errands');
    if (order.status !== 'PENDING_APPROVAL') throw new ConflictException('This errand is not waiting for approval');
    return order;
  }

  async approve(orderId: string, approverId: string) {
    const order = await this.approverFor(orderId, approverId);
    const approved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING_APPROVAL' },
        data: { status: 'PENDING', approvedById: approverId, paidAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The order changed. Please refresh');
      const updated = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      await this.payments.holdFromBusinessCredit(tx, updated, order.business!.creditLimit);
      await tx.orderEvent.create({
        data: { orderId, status: 'PENDING', actorId: approverId, note: `Approved · billed to ${order.business!.name}` },
      });
      return updated;
    });
    this.dispatch.orderUpdated(orderId, order.customerId, null, 'PENDING');
    await this.dispatch.newJob(approved);
    await this.inbox.notify([order.customerId], {
      title: 'Errand approved',
      body: `${order.orderNumber} was approved and is looking for a runner.`,
      link: `/orders/${orderId}`,
    });
    return this.getForViewer(orderId, { id: approverId, staffRole: null });
  }

  async rejectApproval(orderId: string, approverId: string, reason: string) {
    const order = await this.approverFor(orderId, approverId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING_APPROVAL' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Not approved: ${reason}` },
      });
      if (count === 0) throw new ConflictException('The order changed. Please refresh');
      await tx.orderEvent.create({ data: { orderId, status: 'CANCELLED', actorId: approverId, note: `Not approved: ${reason}` } });
    });
    this.dispatch.orderUpdated(orderId, order.customerId, null, 'CANCELLED');
    await this.inbox.notify([order.customerId], {
      title: 'Errand not approved',
      body: `${order.orderNumber}: ${reason}`,
      link: `/orders/${orderId}`,
    });
    return this.getForViewer(orderId, { id: approverId, staffRole: null });
  }

  // ─── Reading ───

  async listForCustomer(customerId: string, scope?: 'active' | 'past') {
    return this.prisma.order.findMany({
      where: { customerId, ...this.scopeFilter(scope) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        description: true,
        total: true,
        createdAt: true,
        category: { select: { name: true } },
        dropoffLabel: true,
      },
    });
  }

  async listForRunner(runnerId: string, scope?: 'active' | 'past') {
    const orders = await this.prisma.order.findMany({
      where: { runnerId, ...this.scopeFilter(scope) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        description: true,
        runnerEarnings: true,
        itemsCost: true,
        createdAt: true,
        completedAt: true,
        category: { select: { name: true } },
      },
    });
    return orders.map(({ itemsCost, ...o }) => ({ ...o, runnerFee: o.runnerEarnings - itemsCost }));
  }

  private scopeFilter(scope?: 'active' | 'past'): Prisma.OrderWhereInput {
    if (scope === 'active') return { status: { in: [...ACTIVE_ORDER_STATUSES] } };
    if (scope === 'past') return { status: { notIn: [...ACTIVE_ORDER_STATUSES] } };
    return {};
  }

  /** One order, shaped for whoever is looking: customer, assigned runner, or staff. */
  async getForViewer(orderId: string, viewer: Pick<AuthUser, 'id' | 'staffRole'>) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
    const isCustomer = order?.customerId === viewer.id;
    const isRunner = !!order?.runnerId && order.runnerId === viewer.id;
    // Company owners/admins see their company's errands; shop staff see errands from their shop.
    const isOrgViewer =
      !!order &&
      !isCustomer &&
      !isRunner &&
      ((!!order.businessId &&
        !!(await this.prisma.businessMember.findFirst({
          where: { businessId: order.businessId, userId: viewer.id, role: { in: ['OWNER', 'ADMIN'] } },
        }))) ||
        (!!order.merchantId &&
          !!(await this.prisma.merchantMember.findFirst({ where: { merchantId: order.merchantId, userId: viewer.id } }))));
    if (!order || (!isCustomer && !isRunner && !isOrgViewer && !viewer.staffRole)) throw new NotFoundException('Order not found');
    return this.toView(order, isCustomer || !!viewer.staffRole, viewer.id);
  }

  private toView(order: OrderWithDetails, canSeePin: boolean, viewerId: string) {
    const { deliveryPin, pinAttempts: _pinAttempts, pricingSnapshot, runner, reviews, payments, escrow, ...rest } = order;
    const runnerActive = RUNNER_ACTIVE_STATUSES.includes(order.status);
    return {
      ...rest,
      // What the runner keeps; runnerEarnings also includes paying back the items they bought.
      runnerFee: order.runnerEarnings - order.itemsCost,
      deliveryPin: canSeePin ? deliveryPin : undefined,
      runner: runner && {
        id: runner.id,
        firstName: runner.firstName,
        lastName: runner.lastName,
        photoUrl: runner.photoUrl,
        // Phone numbers are shared only while the errand is in progress.
        phone: runnerActive ? runner.phone : undefined,
        rating: runner.runnerProfile?.ratingAvg ?? 0,
        ratingCount: runner.runnerProfile?.ratingCount ?? 0,
        jobsCompleted: runner.runnerProfile?.jobsCompleted ?? 0,
        vehicle: runner.runnerProfile?.vehicles.find((v) => v.type === order.deliveryType) ?? null,
        location:
          runnerActive && runner.runnerProfile?.lastLat != null && runner.runnerProfile.lastLng != null
            ? { lat: runner.runnerProfile.lastLat, lng: runner.runnerProfile.lastLng, at: runner.runnerProfile.lastSeenAt }
            : null,
      },
      customer: { ...order.customer, phone: runnerActive || canSeePin ? order.customer.phone : undefined },
      myReview: reviews.find((r) => r.authorId === viewerId) ?? null,
      // Only the customer and staff see payment details.
      payment: canSeePin ? (payments[0] ?? null) : undefined,
      escrowStatus: escrow?.status ?? null,
      /** Predicted arrival while the errand is in progress. */
      expectedBy:
        runnerActive && order.acceptedAt && order.predictedMinutes
          ? new Date(order.acceptedAt.getTime() + order.predictedMinutes * 60_000)
          : null,
      quote: (pricingSnapshot as { quote?: unknown } | null)?.quote ?? null,
    };
  }

  // ─── Runner jobs ───

  private async eligibleRunner(runnerId: string) {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: runnerId } });
    if (!profile || profile.applicationStatus !== 'APPROVED') throw new ForbiddenException('Your runner account is not approved yet');
    return profile;
  }

  /** Open errands this runner can take, nearest first. */
  async availableJobs(runnerId: string) {
    const profile = await this.eligibleRunner(runnerId);
    if (!profile.isOnline) return [];
    if (profile.lastLat == null || profile.lastLng == null) throw new BadRequestException('Share your location to see nearby jobs');
    const here = { lat: profile.lastLat, lng: profile.lastLng };
    const radius = profile.maxDistanceKm ?? DEFAULT_JOB_RADIUS_KM;

    // Rough box around the runner first, so the database only returns nearby
    // jobs (never "the oldest 200 in the city"); exact distance is checked below.
    const dLat = radius / 111;
    const dLng = radius / (111 * Math.cos((here.lat * Math.PI) / 180));
    const near = { lat: { gte: here.lat - dLat, lte: here.lat + dLat }, lng: { gte: here.lng - dLng, lte: here.lng + dLng } };
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        runnerId: null,
        customerId: { not: runnerId },
        deliveryType: { in: profile.deliveryTypes },
        categorySlug: { in: profile.servicesOffered },
        // Jobs start at the pickup, or at the drop-off when there's no pickup.
        OR: [
          { pickupLat: near.lat, pickupLng: near.lng },
          { pickupLat: null, dropoffLat: near.lat, dropoffLng: near.lng },
        ],
      },
      // Newest first: a backlog of old unclaimed errands mustn't hide new ones.
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        orderNumber: true,
        description: true,
        urgency: true,
        scheduledFor: true,
        pickupAddress: true,
        pickupLat: true,
        pickupLng: true,
        dropoffAddress: true,
        dropoffLat: true,
        dropoffLng: true,
        distanceKm: true,
        itemsCost: true,
        runnerEarnings: true,
        surgeFee: true,
        createdAt: true,
        category: { select: { name: true } },
      },
    });
    const config = orders.some((o) => o.surgeFee > 0) ? await this.pricing.getConfig() : null;

    return orders
      .map((o) => ({ order: o, awayKm: Math.round(haversineKm(here, jobStart(o)) * 10) / 10 }))
      .filter((j) => j.awayKm <= radius)
      .sort((a, b) => a.awayKm - b.awayKm)
      .slice(0, 50)
      .map(({ order: o, awayKm }) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        category: o.category.name,
        description: o.description,
        urgency: o.urgency,
        scheduledFor: o.scheduledFor,
        pickupAddress: o.pickupAddress,
        dropoffAddress: o.dropoffAddress,
        distanceKm: o.distanceKm,
        awayKm,
        itemsCost: o.itemsCost,
        runnerEarnings: o.runnerEarnings,
        runnerFee: o.runnerEarnings - o.itemsCost,
        /** Extra the runner earns because demand is high here (the runner's share of the surge fee). */
        surgeBonus: config ? o.surgeFee - Math.round(o.surgeFee * (1 - config.surge.runnerShare)) : 0,
        createdAt: o.createdAt,
      }));
  }

  async accept(orderId: string, runnerId: string) {
    const profile = await this.eligibleRunner(runnerId);
    if (!profile.isOnline) throw new ForbiddenException('Go online to accept jobs');
    const busy = await this.prisma.order.count({ where: { runnerId, status: { in: [...RUNNER_ACTIVE_STATUSES] } } });
    if (busy > 0) throw new ConflictException('Finish your current errand before accepting another');

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Job not found');
    if (order.customerId === runnerId) throw new ForbiddenException('You cannot accept your own errand');
    if (!profile.deliveryTypes.includes(order.deliveryType) || !profile.servicesOffered.includes(order.categorySlug)) {
      throw new ForbiddenException('This job does not match your delivery type or services');
    }
    if (order.paymentMethod === 'CASH') {
      const wallet = await this.prisma.wallet.findUnique({
        where: { type_userId: { type: 'RUNNER', userId: runnerId } },
        select: { balance: true },
      });
      if ((wallet?.balance ?? 0) < -CASH_DEBT_LIMIT) {
        throw new ForbiddenException(
          `You owe KES ${(-wallet!.balance).toLocaleString('en-KE')} in fees from cash errands. Complete M-Pesa errands to clear it before taking cash jobs`,
        );
      }
    }

    // Only succeeds if nobody else took it first.
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING', runnerId: null },
      data: { status: 'ACCEPTED', runnerId, acceptedAt: new Date(), predictedMinutes: await this.predictions.predictMinutes(order) },
    });
    if (count === 0) throw new ConflictException('Sorry, another runner already took this job');

    await this.prisma.orderEvent.create({ data: { orderId, status: 'ACCEPTED', actorId: runnerId, note: 'Runner accepted' } });
    this.dispatch.jobTaken(orderId);
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'ACCEPTED');
    return this.getForViewer(orderId, { id: runnerId, staffRole: null });
  }

  private async runnerOrder(orderId: string, runnerId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, runnerId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async progress(orderId: string, runnerId: string, status: RunnerProgressStatus, at?: { lat?: number; lng?: number }) {
    const order = await this.runnerOrder(orderId, runnerId);
    if (!RUNNER_ACTIVE_STATUSES.includes(order.status) || !isForwardMove(order.status, status)) {
      throw new ConflictException(`Can't move from ${order.status} to ${status}`);
    }
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status, ...(status === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}) },
    });
    if (count === 0) throw new ConflictException('The order changed. Please refresh');
    await this.prisma.orderEvent.create({ data: { orderId, status, actorId: runnerId, lat: at?.lat, lng: at?.lng } });
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, status);
    return this.getForViewer(orderId, { id: runnerId, staffRole: null });
  }

  /** Runner enters the customer's PIN at hand-over; this completes the order. */
  async deliver(orderId: string, runnerId: string, pin: string) {
    const order = await this.runnerOrder(orderId, runnerId);
    if (!RUNNER_ACTIVE_STATUSES.includes(order.status)) throw new ConflictException('This order is not in progress');
    if (order.pinAttempts >= MAX_PIN_ATTEMPTS) {
      throw new HttpException('Too many wrong PINs. Please contact support to complete this delivery', HttpStatus.LOCKED);
    }
    if (pin !== order.deliveryPin) {
      await this.prisma.order.update({ where: { id: orderId }, data: { pinAttempts: { increment: 1 } } });
      const left = MAX_PIN_ATTEMPTS - order.pinAttempts - 1;
      throw new BadRequestException(
        `Wrong PIN. Ask the customer for the 4-digit delivery PIN in their app (${left} attempt${left === 1 ? '' : 's'} left)`,
      );
    }

    const now = new Date();
    // Where the runner was when the PIN was entered (if their location is recent).
    const runnerAt = await this.prisma.runnerProfile.findUnique({
      where: { userId: runnerId },
      select: { lastLat: true, lastLng: true, lastSeenAt: true },
    });
    const fresh =
      runnerAt?.lastLat != null &&
      runnerAt.lastLng != null &&
      !!runnerAt.lastSeenAt &&
      now.getTime() - runnerAt.lastSeenAt.getTime() < 10 * 60_000;
    const deliveryDistanceKm = fresh
      ? Math.round(
          haversineKm({ lat: runnerAt.lastLat!, lng: runnerAt.lastLng! }, { lat: order.dropoffLat, lng: order.dropoffLng }) * 100,
        ) / 100
      : null;
    const rewards = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status: 'COMPLETED', deliveredAt: now, completedAt: now, deliveryDistanceKm },
      });
      if (count === 0) throw new ConflictException('The order changed. Please refresh');
      await tx.orderEvent.createMany({
        data: [
          { orderId, status: 'DELIVERED', actorId: runnerId, createdAt: now },
          { orderId, status: 'COMPLETED', actorId: runnerId, note: 'Delivery PIN confirmed', createdAt: new Date(now.getTime() + 1) },
        ],
      });
      await tx.runnerProfile.update({ where: { userId: runnerId }, data: { jobsCompleted: { increment: 1 } } });
      if (order.paidAt) await this.payments.releaseEscrow(tx, order, runnerId);
      else await this.payments.chargeCashCommission(tx, order, runnerId);
      await this.payments.chargeMerchantCommission(tx, order);
      return this.rewards.onOrderCompleted(tx, order);
    });
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'COMPLETED');
    await this.rewards.notify(rewards);
    await this.risk
      .onDelivered(order, runnerId, deliveryDistanceKm)
      .catch((error: Error) => this.logger.error(`Risk check failed: ${error.message}`));
    return this.getForViewer(orderId, { id: runnerId, staffRole: null });
  }

  async cancelByCustomer(orderId: string, customerId: string, reason: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    return this.cancel(order, customerId, reason, CUSTOMER_CANCELLABLE_STATUSES, 'This errand can no longer be cancelled. Contact support');
  }

  async cancel(order: Order, actorId: string, reason: string, allowed: readonly OrderStatus[], refusal: string) {
    if (!allowed.includes(order.status)) throw new ConflictException(refusal);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
      if (count === 0) throw new ConflictException('The order changed. Please refresh');
      const refunded = await this.payments.refundEscrow(tx, order);
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: 'CANCELLED',
          actorId,
          note: refunded ? `${reason} · KES ${order.total} refunded to wallet` : reason,
        },
      });
    });
    if (order.status === 'PENDING') this.dispatch.jobTaken(order.id);
    this.dispatch.orderUpdated(order.id, order.customerId, order.runnerId, 'CANCELLED');
    return this.getForViewer(order.id, { id: order.customerId, staffRole: null });
  }

  /** Runner hands the job back; it goes back to the open job list. */
  async release(orderId: string, runnerId: string, reason: string) {
    const order = await this.runnerOrder(orderId, runnerId);
    if (!RUNNER_RELEASABLE_STATUSES.includes(order.status)) {
      throw new ConflictException('You have already picked up the items. Contact support if you cannot finish');
    }
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, runnerId, status: order.status },
      data: { status: 'PENDING', runnerId: null, acceptedAt: null },
    });
    if (count === 0) throw new ConflictException('The order changed. Please refresh');
    await this.prisma.orderEvent.create({
      data: { orderId, status: 'PENDING', actorId: runnerId, note: `Runner released the job: ${reason}` },
    });
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'PENDING');
    await this.dispatch.newJob({ ...order, status: 'PENDING', runnerId: null });
    return { released: true };
  }

  /** Admin: give a job to a specific runner. */
  async assign(orderId: string, runnerId: string, actorId: string) {
    await this.eligibleRunner(runnerId);
    const pending = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!pending) throw new NotFoundException('Order not found');
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING', runnerId: null, customerId: { not: runnerId } },
      data: {
        status: 'RUNNER_ASSIGNED',
        runnerId,
        acceptedAt: new Date(),
        predictedMinutes: await this.predictions.predictMinutes(pending),
      },
    });
    if (count === 0) throw new ConflictException('Only orders still looking for a runner can be assigned');
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await this.prisma.orderEvent.create({ data: { orderId, status: 'RUNNER_ASSIGNED', actorId, note: 'Assigned by support' } });
    this.dispatch.jobTaken(orderId);
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'RUNNER_ASSIGNED');
    return this.getForViewer(orderId, { id: actorId, staffRole: 'SUPER_ADMIN' });
  }

  // ─── Live location ───

  async updateRunnerLocation(runnerId: string, lat: number, lng: number) {
    const at = new Date();
    await this.prisma.runnerProfile.update({ where: { userId: runnerId }, data: { lastLat: lat, lastLng: lng, lastSeenAt: at } });
    const active = await this.prisma.order.findMany({
      where: { runnerId, status: { in: [...RUNNER_ACTIVE_STATUSES] } },
      select: { id: true, customerId: true },
    });
    for (const order of active) {
      const payload = { orderId: order.id, lat, lng, at };
      this.realtime.toOrder(order.id, 'runner.location', payload);
      this.realtime.toUsers([order.customerId], 'runner.location', payload);
    }
    return { ok: true };
  }

  // ─── Chat ───

  private async chatOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, OR: [{ customerId: userId }, { runnerId: userId }] } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listMessages(orderId: string, userId: string) {
    await this.chatOrder(orderId, userId);
    return this.prisma.orderMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, body: true, createdAt: true, senderId: true },
    });
  }

  async sendMessage(orderId: string, userId: string, body: string) {
    const order = await this.chatOrder(orderId, userId);
    if (!order.runnerId) throw new ConflictException('Chat opens once a runner accepts the errand');
    const endedAt = order.completedAt ?? order.cancelledAt;
    if (endedAt && Date.now() - endedAt.getTime() > CHAT_GRACE_MS) throw new ConflictException('Chat for this errand has closed');

    const message = await this.prisma.orderMessage.create({
      data: { orderId, senderId: userId, body },
      select: { id: true, body: true, createdAt: true, senderId: true },
    });
    const payload = { orderId, message };
    this.realtime.toUsers([order.customerId, order.runnerId], 'order.message', payload);
    return message;
  }

  // ─── Ratings ───

  async review(orderId: string, userId: string, dto: ReviewDto) {
    const order = await this.chatOrder(orderId, userId);
    if (order.status !== 'COMPLETED') throw new ConflictException('You can rate once the errand is completed');
    const ratingRunner = order.customerId === userId;
    const subjectId = ratingRunner ? order.runnerId! : order.customerId;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.review.create({ data: { orderId, authorId: userId, subjectId, stars: dto.stars, comment: dto.comment } });
        if (ratingRunner) await recalculateRunnerRating(tx, subjectId);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('You already rated this errand');
      throw error;
    }
    return this.getForViewer(orderId, { id: userId, staffRole: null });
  }
}
