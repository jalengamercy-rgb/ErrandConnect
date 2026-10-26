import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES, DEFAULT_MERCHANT_COMMISSION_RATE, haversineKm } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { OrderStatus, OrgStatus, Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService } from '../realtime/dispatch.service.js';
import type {
  AdminUpdateMerchantDto,
  MerchantDirectoryQueryDto,
  MerchantListQueryDto,
  MerchantOrdersQueryDto,
  RegisterMerchantDto,
  UpdateMerchantDto,
} from './merchants.dto.js';

/** What customers see about a shop. */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  logoUrl: true,
  categorySlug: true,
  phone: true,
  addressLine: true,
  lat: true,
  lng: true,
  description: true,
  isFeatured: true,
  ratingAvg: true,
  ratingCount: true,
} satisfies Prisma.MerchantSelect;

/** Statuses where the shop still has something to do or watch. */
const SHOP_ACTIVE: OrderStatus[] = ACTIVE_ORDER_STATUSES.filter((s) => s !== 'PENDING_APPROVAL' && s !== 'AWAITING_PAYMENT');

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly dispatch: DispatchService,
    private readonly audit: AuditService,
  ) {}

  private async membership(merchantId: string, userId: string, manage = false) {
    const member = await this.prisma.merchantMember.findUnique({
      where: { merchantId_userId: { merchantId, userId } },
      include: { merchant: true },
    });
    if (!member) throw new NotFoundException('Shop not found');
    if (manage && member.role === 'MEMBER') throw new ForbiddenException('Only shop owners and admins can do this');
    return member;
  }

  // ─── Customers ───

  /** Active shops: featured first, then nearest (if a location is given), then best rated. */
  async directory(query: MerchantDirectoryQueryDto) {
    const shops = await this.prisma.merchant.findMany({
      where: {
        status: 'ACTIVE',
        lat: { not: null },
        categorySlug: query.category,
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      select: PUBLIC_FIELDS,
      take: 200,
    });
    const here = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : null;
    return shops
      .map((s) => ({ ...s, distanceKm: here ? Math.round(haversineKm(here, { lat: s.lat!, lng: s.lng! }) * 10) / 10 : null }))
      .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || b.ratingAvg - a.ratingAvg)
      .slice(0, 50);
  }

  async publicProfile(merchantId: string) {
    const shop = await this.prisma.merchant.findFirst({ where: { id: merchantId, status: 'ACTIVE' }, select: PUBLIC_FIELDS });
    if (!shop) throw new NotFoundException('Shop not found');
    return shop;
  }

  // ─── Shop owners ───

  async register(userId: string, dto: RegisterMerchantDto) {
    const category = await this.prisma.serviceCategory.findFirst({ where: { slug: dto.categorySlug, isActive: true } });
    if (!category) throw new BadRequestException('Unknown errand type');
    const owned = await this.prisma.merchantMember.count({
      where: { userId, role: 'OWNER', merchant: { status: { in: ['PENDING', 'ACTIVE'] } } },
    });
    if (owned >= 5) throw new ConflictException('You already own the maximum number of shops');
    const merchant = await this.prisma.merchant.create({ data: { ...dto, members: { create: { userId, role: 'OWNER' } } } });
    await this.audit.log({ actorId: userId, action: 'merchant.register', entityType: 'merchant', entityId: merchant.id });
    return merchant;
  }

  async mine(userId: string) {
    const memberships = await this.prisma.merchantMember.findMany({
      where: { userId },
      include: { merchant: { select: { id: true, name: true, status: true, addressLine: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.merchant, role: m.role }));
  }

  async get(merchantId: string, userId: string) {
    const me = await this.membership(merchantId, userId);
    const [wallet, open, month] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { type_merchantId: { type: 'MERCHANT', merchantId } } }),
      this.prisma.order.count({ where: { merchantId, status: { in: SHOP_ACTIVE } } }),
      this.prisma.order.aggregate({
        where: { merchantId, status: 'COMPLETED', completedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _count: true,
        _sum: { itemsCost: true, merchantCommission: true },
      }),
    ]);
    return {
      ...me.merchant,
      commissionRate: me.merchant.commissionRate ?? DEFAULT_MERCHANT_COMMISSION_RATE,
      myRole: me.role,
      // A negative balance is commission owed to ErrandCONNECT.
      commissionOwed: Math.max(0, -(wallet?.balance ?? 0)),
      openOrders: open,
      thisMonth: { orders: month._count, sales: month._sum.itemsCost ?? 0, commission: month._sum.merchantCommission ?? 0 },
    };
  }

  async update(merchantId: string, userId: string, dto: UpdateMerchantDto) {
    await this.membership(merchantId, userId, true);
    return this.prisma.merchant.update({ where: { id: merchantId }, data: dto });
  }

  async listOrders(merchantId: string, userId: string, query: MerchantOrdersQueryDto) {
    await this.membership(merchantId, userId);
    const where: Prisma.OrderWhereInput = {
      merchantId,
      status: query.view === 'PAST' ? { notIn: [...ACTIVE_ORDER_STATUSES] } : { in: SHOP_ACTIVE },
    };
    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: query.view === 'PAST' ? 'desc' : 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          description: true,
          itemsCost: true,
          merchantCommission: true,
          merchantReadyAt: true,
          scheduledFor: true,
          createdAt: true,
          customer: { select: { firstName: true } },
          runner: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
    ]);
    // Only share the runner's phone while they are coming to the shop.
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: items.map((o) => ({
        ...o,
        runner: o.runner && { ...o.runner, phone: SHOP_ACTIVE.includes(o.status) ? o.runner.phone : undefined },
      })),
    };
  }

  /** The shop has packed the items: tell the runner (and customer). */
  async markReady(merchantId: string, userId: string, orderId: string) {
    await this.membership(merchantId, userId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, merchantId } });
    if (!order) throw new NotFoundException('Order not found');
    if (!SHOP_ACTIVE.includes(order.status) || ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) {
      throw new ConflictException('This order can no longer be marked ready');
    }
    if (order.merchantReadyAt) return { readyAt: order.merchantReadyAt };
    const readyAt = new Date();
    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { merchantReadyAt: readyAt } }),
      this.prisma.orderEvent.create({
        data: { orderId, status: order.status, actorId: userId, note: 'The shop has the order ready for pickup' },
      }),
    ]);
    this.dispatch.orderUpdated(orderId, order.customerId, order.runnerId, order.status);
    await this.inbox.notify(
      [order.runnerId, order.customerId].filter((id): id is string => !!id),
      {
        title: 'Order ready at the shop',
        body: `${order.orderNumber} is packed and ready for pickup.`,
        link: `/orders/${orderId}`,
      },
    );
    return { readyAt };
  }

  // ─── Admin ───

  async adminList(query: MerchantListQueryDto) {
    const where: Prisma.MerchantWhereInput = {
      status: query.status,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { orders: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async adminGet(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        members: { include: { user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 12 },
      },
    });
    if (!merchant) throw new NotFoundException('Shop not found');
    const [wallet, sales] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { type_merchantId: { type: 'MERCHANT', merchantId } } }),
      this.prisma.order.aggregate({
        where: { merchantId, status: 'COMPLETED' },
        _count: true,
        _sum: { itemsCost: true, merchantCommission: true },
      }),
    ]);
    return {
      ...merchant,
      commissionOwed: Math.max(0, -(wallet?.balance ?? 0)),
      completedOrders: sales._count,
      totalSales: sales._sum.itemsCost ?? 0,
      totalCommission: sales._sum.merchantCommission ?? 0,
    };
  }

  async setStatus(merchantId: string, status: Extract<OrgStatus, 'ACTIVE' | 'REJECTED' | 'SUSPENDED'>, admin: AuthUser, reason?: string) {
    const from: OrgStatus[] = status === 'ACTIVE' ? ['PENDING', 'SUSPENDED', 'REJECTED'] : status === 'REJECTED' ? ['PENDING'] : ['ACTIVE'];
    const merchant = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.merchant.updateMany({ where: { id: merchantId, status: { in: from } }, data: { status } });
      if (count === 0) throw new ConflictException(`This shop cannot be moved to ${status.toLowerCase()} from its current status`);
      await this.audit.log(
        {
          actorId: admin.id,
          action: `merchant.${status.toLowerCase()}`,
          entityType: 'merchant',
          entityId: merchantId,
          metadata: { reason },
        },
        tx,
      );
      return tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    });
    const owners = await this.prisma.merchantMember.findMany({
      where: { merchantId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    });
    const title = { ACTIVE: 'Your shop is live', REJECTED: 'Shop not approved', SUSPENDED: 'Shop suspended' }[status];
    await this.inbox.notify(
      owners.map((o) => o.userId),
      { title, body: reason ?? `${merchant.name} now appears in the ErrandCONNECT shop directory.`, link: `/shop/${merchantId}` },
    );
    return merchant;
  }

  async adminUpdate(merchantId: string, dto: AdminUpdateMerchantDto, admin: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.update({ where: { id: merchantId }, data: dto });
      await this.audit.log(
        { actorId: admin.id, action: 'merchant.update', entityType: 'merchant', entityId: merchantId, metadata: { ...dto } },
        tx,
      );
      return merchant;
    });
  }
}
