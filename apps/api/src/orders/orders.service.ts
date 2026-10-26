import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  CASH_DEBT_LIMIT,
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
        select: { ratingAvg: true, ratingCount: true, jobsCompleted: true, lastLat: true, lastLng: true, lastSeenAt: true, vehicles: { select: { type: true, registrationNumber: true, make: true, model: true, color: true } } },
      },
    },
  },
  events: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, createdAt: true } },
  reviews: { select: { authorId: true, stars: true, comment: true } },
  escrow: { select: { status: true } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, failureReason: true, providerReceipt: true, phone: true, createdAt: true } },
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
  ) {}

  // ─── Pricing & creation (customers) ───

  private async resolveDropoff(customerId: string, dto: OrderDetailsDto): Promise<LocationDto> {
    if (dto.dropoffAddressId) {
      const address = await this.prisma.address.findFirst({ where: { id: dto.dropoffAddressId, userId: customerId } });
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
    // Without a pickup point the runner starts near the customer; the base fee covers that.
    const distanceKm = dto.pickup ? estimateRoadKm(dto.pickup, dropoff) : 0;
    const config = await this.pricing.getConfig();
    const quote = calculateQuote(
      { itemsCost: dto.itemsCost ?? 0, errandFee: category.baseFee, distanceKm, deliveryType: dto.deliveryType, urgency: dto.urgency },
      config,
    );
    return { category, dropoff, distanceKm, quote, config };
  }

  async create(customerId: string, dto: CreateOrderDto) {
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (scheduledFor && (scheduledFor.getTime() < Date.now() + 15 * 60_000 || scheduledFor.getTime() > Date.now() + 14 * 24 * 60 * 60_000)) {
      throw new BadRequestException('Schedule between 15 minutes and 14 days from now');
    }

    const { category, dropoff, distanceKm, quote, config } = await this.quote(customerId, dto);

    const profile = await this.prisma.customerProfile.findUniqueOrThrow({ where: { userId: customerId }, select: { verificationLevel: true } });
    const limit = ORDER_LIMIT_BY_LEVEL[profile.verificationLevel];
    if (limit !== null && limit !== undefined && quote.customer.total > limit) {
      throw new ForbiddenException(
        `Orders above KES ${limit.toLocaleString('en-KE')} need a higher verification level. Verify your ${profile.verificationLevel === 1 ? 'email' : 'ID'} to continue.`,
      );
    }
    const active = await this.prisma.order.count({ where: { customerId, status: { in: [...ACTIVE_ORDER_STATUSES] } } });
    if (active >= MAX_ACTIVE_ORDERS_PER_CUSTOMER) {
      throw new ConflictException(`You can have up to ${MAX_ACTIVE_ORDERS_PER_CUSTOMER} active errands at a time`);
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = await uniqueCode(
      () => `EC-${today}-${randomDigits(5)}`,
      async (code) => !!(await this.prisma.order.findUnique({ where: { orderNumber: code }, select: { id: true } })),
    );

    const method = dto.paymentMethod;
    const data = {
        orderNumber,
        customerId,
        categorySlug: category.slug,
        description: dto.description,
        deliveryType: dto.deliveryType,
        urgency: dto.urgency ?? 'STANDARD',
        scheduledFor,
        pickupLabel: dto.pickup?.label,
        pickupAddress: dto.pickup?.address,
        pickupLat: dto.pickup?.lat,
        pickupLng: dto.pickup?.lng,
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
        total: quote.customer.total,
        runnerEarnings: quote.runner.total,
        platformFee: quote.platform.total,
        pricingSnapshot: { quote, config } as unknown as Prisma.InputJsonValue,
        paymentMethod: method,
        deliveryPin: randomDigits(4),
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
      const phone = dto.mpesaPhone ?? (await this.prisma.user.findUniqueOrThrow({ where: { id: customerId }, select: { phone: true } })).phone;
      // If the prompt can't be sent, the order stays unpaid and the customer can retry.
      const paymentRequest = await this.payments.requestMpesaPayment(order, phone).catch((error: Error) => ({ requested: false, message: error.message }));
      return { ...(await this.getForViewer(order.id, { id: customerId, staffRole: null })), paymentRequest };
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          ...data,
          status: 'PENDING',
          paidAt: method === 'WALLET' ? new Date() : null,
          events: { create: { status: 'PENDING', actorId: customerId, note: method === 'WALLET' ? 'Errand posted · paid from wallet' : 'Errand posted · cash on delivery' } },
        },
      });
      if (method === 'WALLET') await this.payments.holdFromWallet(tx, created);
      return created;
    });

    await this.dispatch.newJob(order);
    return this.getForViewer(order.id, { id: customerId, staffRole: null });
  }

  // ─── Reading ───

  async listForCustomer(customerId: string, scope?: 'active' | 'past') {
    return this.prisma.order.findMany({
      where: { customerId, ...this.scopeFilter(scope) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, orderNumber: true, status: true, description: true, total: true, createdAt: true, category: { select: { name: true } }, dropoffLabel: true },
    });
  }

  async listForRunner(runnerId: string, scope?: 'active' | 'past') {
    const orders = await this.prisma.order.findMany({
      where: { runnerId, ...this.scopeFilter(scope) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, orderNumber: true, status: true, description: true, runnerEarnings: true, itemsCost: true, createdAt: true, completedAt: true, category: { select: { name: true } } },
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
    if (!order || (!isCustomer && !isRunner && !viewer.staffRole)) throw new NotFoundException('Order not found');
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

    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        runnerId: null,
        customerId: { not: runnerId },
        deliveryType: { in: profile.deliveryTypes },
        categorySlug: { in: profile.servicesOffered },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { category: { select: { name: true } } },
    });

    return orders
      .map((o) => ({ order: o, awayKm: Math.round(haversineKm(here, jobStart(o)) * 10) / 10 }))
      .filter((j) => j.awayKm <= radius)
      .sort((a, b) => a.awayKm - b.awayKm)
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
      const wallet = await this.prisma.wallet.findUnique({ where: { type_userId: { type: 'RUNNER', userId: runnerId } }, select: { balance: true } });
      if ((wallet?.balance ?? 0) < -CASH_DEBT_LIMIT) {
        throw new ForbiddenException(
          `You owe KES ${(-wallet!.balance).toLocaleString('en-KE')} in fees from cash errands. Complete M-Pesa errands to clear it before taking cash jobs`,
        );
      }
    }

    // Only succeeds if nobody else took it first.
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING', runnerId: null },
      data: { status: 'ACCEPTED', runnerId, acceptedAt: new Date() },
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
      throw new BadRequestException(`Wrong PIN. Ask the customer for the 4-digit delivery PIN in their app (${left} attempt${left === 1 ? '' : 's'} left)`);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status: 'COMPLETED', deliveredAt: now, completedAt: now },
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
    });
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'COMPLETED');
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
        data: { orderId: order.id, status: 'CANCELLED', actorId, note: refunded ? `${reason} · KES ${order.total} refunded to wallet` : reason },
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
    await this.prisma.orderEvent.create({ data: { orderId, status: 'PENDING', actorId: runnerId, note: `Runner released the job: ${reason}` } });
    this.dispatch.orderUpdated(orderId, order.customerId, runnerId, 'PENDING');
    await this.dispatch.newJob({ ...order, status: 'PENDING', runnerId: null });
    return { released: true };
  }

  /** Admin: give a job to a specific runner. */
  async assign(orderId: string, runnerId: string, actorId: string) {
    await this.eligibleRunner(runnerId);
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING', runnerId: null, customerId: { not: runnerId } },
      data: { status: 'RUNNER_ASSIGNED', runnerId, acceptedAt: new Date() },
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
        if (ratingRunner) {
          // Only reviews about this person *as a runner* count towards their runner rating.
          const stats = await tx.review.aggregate({
            where: { subjectId, isHidden: false, order: { runnerId: subjectId } },
            _avg: { stars: true },
            _count: true,
          });
          await tx.runnerProfile.update({
            where: { userId: subjectId },
            data: { ratingAvg: Math.round((stats._avg.stars ?? 0) * 100) / 100, ratingCount: stats._count },
          });
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('You already rated this errand');
      throw error;
    }
    return this.getForViewer(orderId, { id: userId, staffRole: null });
  }
}
