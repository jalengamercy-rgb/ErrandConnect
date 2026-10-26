import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES, validatePricingConfig, type PricingConfig } from '@errandconnect/shared';
import type { AuthUser } from '../common/auth-user.js';
import { AuditService } from '../common/audit.service.js';
import { Prisma, type StaffRole } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { MessagingService } from '../notifications/messaging.service.js';
import { recalculateRunnerRating } from '../orders/ratings.js';
import { PRICING_SETTING_KEY, PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddStaffDto, BroadcastDto, CategoryCreateDto, CategoryUpdateDto, ReviewListQueryDto } from './ops.dto.js';

const DAY_MS = 24 * 60 * 60_000;

/** Escapes a value for a CSV cell. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  // Prefix formulas so spreadsheets don't execute them (CSV injection).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly messaging: MessagingService,
  ) {}

  // ─── Dashboard ───

  async dashboard() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const active = [...ACTIVE_ORDER_STATUSES];
    const platform = await this.prisma.wallet.findFirst({ where: { type: 'PLATFORM_REVENUE', userId: null } });
    const escrow = await this.prisma.wallet.findFirst({ where: { type: 'ESCROW', userId: null } });

    const [
      revenueToday,
      customers,
      activeCustomers,
      verifiedCustomers,
      runners,
      onlineRunners,
      approvedRunners,
      suspendedRunners,
      pendingRunnerApprovals,
      ordersByStatus,
      scheduledOrders,
      ordersToday,
      deliveryTime,
      rating,
      wallets,
      pendingWithdrawals,
      openDisputes,
      openTickets,
    ] = await Promise.all([
      platform
        ? this.prisma.ledgerEntry.aggregate({ where: { walletId: platform.id, createdAt: { gte: startOfDay } }, _sum: { amount: true } })
        : null,
      this.prisma.customerProfile.count(),
      this.prisma.user.count({ where: { customerProfile: { isNot: null }, ordersAsCustomer: { some: { createdAt: { gte: monthAgo } } } } }),
      this.prisma.customerProfile.count({ where: { verificationLevel: 3 } }),
      this.prisma.runnerProfile.count(),
      this.prisma.runnerProfile.count({ where: { isOnline: true, applicationStatus: 'APPROVED' } }),
      this.prisma.runnerProfile.count({ where: { applicationStatus: 'APPROVED' } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED', runnerProfile: { isNot: null } } }),
      this.prisma.runnerProfile.count({ where: { applicationStatus: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      this.prisma.order.groupBy({ by: ['status'], _count: true }),
      this.prisma.order.count({ where: { status: { in: active }, scheduledFor: { gt: now } } }),
      this.prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.$queryRaw<{ minutes: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::float AS minutes
        FROM orders WHERE status = 'COMPLETED' AND completed_at >= ${monthAgo}`,
      this.prisma.$queryRaw<{ stars: number | null }[]>`
        SELECT AVG(r.stars)::float AS stars FROM reviews r JOIN orders o ON o.id = r.order_id
        WHERE r.subject_id = o.runner_id AND r.is_hidden = false`,
      this.prisma.wallet.groupBy({ by: ['type'], where: { type: { in: ['CUSTOMER', 'RUNNER'] } }, _sum: { balance: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: 'REQUESTED' }, _count: true, _sum: { amount: true } }),
      this.prisma.dispute.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);

    const count = (statuses: string[]) => ordersByStatus.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count, 0);
    const walletSum = (type: string) => wallets.find((w) => w.type === type)?._sum.balance ?? 0;
    return {
      revenue: { total: platform?.balance ?? 0, today: revenueToday?._sum.amount ?? 0 },
      escrowHeld: escrow?.balance ?? 0,
      customers: { total: customers, activeLast30Days: activeCustomers, verified: verifiedCustomers },
      runners: {
        total: runners,
        online: onlineRunners,
        offline: approvedRunners - onlineRunners,
        suspended: suspendedRunners,
        pendingApproval: pendingRunnerApprovals,
      },
      orders: {
        today: ordersToday,
        active: count(active),
        scheduled: scheduledOrders,
        completed: count(['COMPLETED']),
        cancelled: count(['CANCELLED']),
        disputed: count(['DISPUTED']),
      },
      avgDeliveryMinutes: deliveryTime[0]?.minutes ? Math.round(deliveryTime[0].minutes) : null,
      avgRunnerRating: rating[0]?.stars ? Math.round(rating[0].stars * 10) / 10 : null,
      walletBalances: { customers: walletSum('CUSTOMER'), runners: walletSum('RUNNER') },
      pendingWithdrawals: { count: pendingWithdrawals._count, amount: pendingWithdrawals._sum.amount ?? 0 },
      openDisputes,
      openTickets,
    };
  }

  // ─── Reports ───

  /** Platform revenue, orders and completions per day. */
  async dailySeries(days: number) {
    const since = new Date(Date.now() - (days - 1) * DAY_MS);
    since.setHours(0, 0, 0, 0);
    const platform = await this.prisma.wallet.findFirst({ where: { type: 'PLATFORM_REVENUE', userId: null } });
    const [revenue, orders] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; amount: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, SUM(amount) AS amount FROM ledger_entries
        WHERE wallet_id = ${platform?.id ?? ''} AND created_at >= ${since} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: Date; created: bigint; completed: bigint; cancelled: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS created,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
          COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
        FROM orders WHERE created_at >= ${since} GROUP BY 1`,
    ]);
    const key = (d: Date) => d.toISOString().slice(0, 10);
    return Array.from({ length: days }, (_, i) => {
      const day = key(new Date(since.getTime() + i * DAY_MS + 12 * 60 * 60_000));
      const r = revenue.find((x) => key(x.day) === day);
      const o = orders.find((x) => key(x.day) === day);
      return {
        date: day,
        revenue: Number(r?.amount ?? 0),
        orders: Number(o?.created ?? 0),
        completed: Number(o?.completed ?? 0),
        cancelled: Number(o?.cancelled ?? 0),
      };
    });
  }

  async categoryBreakdown(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);
    const [groups, categories] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['categorySlug'],
        where: { createdAt: { gte: since } },
        _count: true,
        _sum: { total: true, platformFee: true },
      }),
      this.prisma.serviceCategory.findMany({ select: { slug: true, name: true } }),
    ]);
    return groups
      .map((g) => ({
        slug: g.categorySlug,
        name: categories.find((c) => c.slug === g.categorySlug)?.name ?? g.categorySlug,
        orders: g._count,
        value: g._sum.total ?? 0,
        revenue: g._sum.platformFee ?? 0,
      }))
      .sort((a, b) => b.orders - a.orders);
  }

  async topRunners(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);
    const groups = await this.prisma.order.groupBy({
      by: ['runnerId'],
      where: { status: 'COMPLETED', completedAt: { gte: since }, runnerId: { not: null } },
      _count: true,
      _sum: { runnerEarnings: true },
      orderBy: { _count: { runnerId: 'desc' } },
      take: 10,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: groups.map((g) => g.runnerId!) } },
      select: { id: true, firstName: true, lastName: true, phone: true, runnerProfile: { select: { ratingAvg: true } } },
    });
    return groups.map((g) => {
      const u = users.find((x) => x.id === g.runnerId);
      return {
        runnerId: g.runnerId,
        name: u ? `${u.firstName} ${u.lastName}` : '',
        phone: u?.phone,
        rating: u?.runnerProfile?.ratingAvg ?? 0,
        completed: g._count,
        earnings: g._sum.runnerEarnings ?? 0,
      };
    });
  }

  async ordersCsv(from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      take: 20_000,
      include: { category: { select: { name: true } }, customer: { select: { phone: true } }, runner: { select: { phone: true } } },
    });
    const header = [
      'order_number',
      'created_at',
      'status',
      'category',
      'customer_phone',
      'runner_phone',
      'payment_method',
      'items_cost',
      'total',
      'runner_earnings',
      'platform_fee',
      'distance_km',
    ];
    const rows = orders.map((o) =>
      [
        o.orderNumber,
        o.createdAt,
        o.status,
        o.category.name,
        o.customer.phone,
        o.runner?.phone,
        o.paymentMethod,
        o.itemsCost,
        o.total,
        o.runnerEarnings,
        o.platformFee,
        o.distanceKm,
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }

  // ─── Live map ───

  async liveMap() {
    const recent = new Date(Date.now() - 30 * 60_000);
    const [runners, orders] = await Promise.all([
      this.prisma.runnerProfile.findMany({
        where: { applicationStatus: 'APPROVED', isOnline: true, lastLat: { not: null }, lastSeenAt: { gte: recent } },
        select: {
          userId: true,
          lastLat: true,
          lastLng: true,
          lastSeenAt: true,
          deliveryTypes: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.order.findMany({
        where: { status: { in: [...ACTIVE_ORDER_STATUSES] } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          runnerId: true,
          pickupLat: true,
          pickupLng: true,
          dropoffLat: true,
          dropoffLng: true,
          category: { select: { name: true } },
        },
        take: 500,
      }),
    ]);
    const busy = new Set(orders.map((o) => o.runnerId).filter(Boolean));
    return {
      runners: runners.map((r) => ({
        id: r.userId,
        name: `${r.user.firstName} ${r.user.lastName}`,
        lat: r.lastLat!,
        lng: r.lastLng!,
        lastSeenAt: r.lastSeenAt,
        deliveryTypes: r.deliveryTypes,
        busy: busy.has(r.userId),
      })),
      orders,
    };
  }

  // ─── Settings ───

  getPricing() {
    return this.pricing.getConfig();
  }

  async updatePricing(config: unknown, admin: AuthUser) {
    const errors = validatePricingConfig(config);
    if (errors.length) throw new BadRequestException({ message: errors, error: 'Bad Request', statusCode: 400 });
    const before = await this.pricing.getConfig();
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: PRICING_SETTING_KEY },
        update: { value: config as Prisma.InputJsonValue, updatedById: admin.id },
        create: { key: PRICING_SETTING_KEY, value: config as Prisma.InputJsonValue, updatedById: admin.id },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'settings.pricing.update',
          entityType: 'setting',
          entityId: PRICING_SETTING_KEY,
          metadata: { before, after: config } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return config as PricingConfig;
  }

  listCategories() {
    return this.prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { orders: true } } } });
  }

  async createCategory(dto: CategoryCreateDto, admin: AuthUser) {
    const max = await this.prisma.serviceCategory.aggregate({ _max: { sortOrder: true } });
    try {
      const category = await this.prisma.serviceCategory.create({ data: { ...dto, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
      await this.audit.log({
        actorId: admin.id,
        action: 'category.create',
        entityType: 'category',
        entityId: dto.slug,
        metadata: { ...dto },
      });
      return category;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A category with this slug exists');
      throw error;
    }
  }

  async updateCategory(slug: string, dto: CategoryUpdateDto, admin: AuthUser) {
    const before = await this.prisma.serviceCategory.findUnique({ where: { slug } });
    if (!before) throw new NotFoundException('Category not found');
    const after = await this.prisma.serviceCategory.update({ where: { slug }, data: dto });
    await this.audit.log({
      actorId: admin.id,
      action: 'category.update',
      entityType: 'category',
      entityId: slug,
      metadata: { before, after } as unknown as Prisma.InputJsonValue,
    });
    return after;
  }

  // ─── Reviews ───

  async listReviews(query: ReviewListQueryDto) {
    const where: Prisma.ReviewWhereInput = {
      ...(query.hidden ? { isHidden: query.hidden === 'true' } : {}),
      ...(query.maxStars ? { stars: { lte: query.maxStars } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          subject: { select: { id: true, firstName: true, lastName: true } },
          order: { select: { id: true, orderNumber: true, runnerId: true } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async setReviewHidden(id: string, hidden: boolean, admin: AuthUser) {
    const review = await this.prisma.review.findUnique({ where: { id }, include: { order: { select: { runnerId: true } } } });
    if (!review) throw new NotFoundException('Review not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({ where: { id }, data: { isHidden: hidden } });
      if (review.subjectId && review.subjectId === review.order.runnerId) await recalculateRunnerRating(tx, review.subjectId);
      await this.audit.log({ actorId: admin.id, action: hidden ? 'review.hide' : 'review.unhide', entityType: 'review', entityId: id }, tx);
    });
    return { id, isHidden: hidden };
  }

  // ─── Staff ───

  listStaff() {
    return this.prisma.staffProfile.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, status: true, lastLoginAt: true } },
      },
    });
  }

  async addStaff(dto: AddStaffDto, admin: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone }, include: { staffProfile: true } });
    if (!user) throw new NotFoundException('No account with this phone. Ask them to sign up in the app first');
    if (user.staffProfile) throw new ConflictException('This person is already staff');
    await this.prisma.staffProfile.create({ data: { userId: user.id, role: dto.role } });
    await this.audit.log({ actorId: admin.id, action: 'staff.add', entityType: 'user', entityId: user.id, metadata: { role: dto.role } });
    return this.listStaff();
  }

  async updateStaff(userId: string, role: StaffRole, admin: AuthUser) {
    if (userId === admin.id) throw new ForbiddenException('You cannot change your own role');
    const staff = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.prisma.staffProfile.update({ where: { userId }, data: { role } });
    await this.audit.log({
      actorId: admin.id,
      action: 'staff.role',
      entityType: 'user',
      entityId: userId,
      metadata: { from: staff.role, to: role },
    });
    return this.listStaff();
  }

  async removeStaff(userId: string, admin: AuthUser) {
    if (userId === admin.id) throw new ForbiddenException('You cannot remove yourself');
    const { count } = await this.prisma.staffProfile.deleteMany({ where: { userId } });
    if (count === 0) throw new NotFoundException('Staff member not found');
    await this.audit.log({ actorId: admin.id, action: 'staff.remove', entityType: 'user', entityId: userId });
    return this.listStaff();
  }

  // ─── Customer detail ───

  async customer(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        emailVerifiedAt: true,
        idVerifiedAt: true,
        referralCode: true,
        customerProfile: { select: { customerCode: true, verificationLevel: true } },
        wallets: { select: { type: true, balance: true } },
        documents: { orderBy: { createdAt: 'desc' }, omit: { storageKey: true } },
        addresses: { select: { id: true, label: true, area: true, city: true } },
        ordersAsCustomer: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, orderNumber: true, status: true, total: true, createdAt: true },
        },
        _count: { select: { ordersAsCustomer: true } },
      },
    });
    if (!user?.customerProfile) throw new NotFoundException('Customer not found');
    const spent = await this.prisma.order.aggregate({ where: { customerId: userId, status: 'COMPLETED' }, _sum: { total: true } });
    return { ...user, lifetimeSpend: spent._sum.total ?? 0 };
  }

  // ─── Announcements ───

  async broadcast(dto: BroadcastDto, admin: AuthUser) {
    const where: Prisma.UserWhereInput = { status: 'ACTIVE' };
    if (dto.audience === 'CUSTOMERS') where.customerProfile = { isNot: null };
    if (dto.audience === 'RUNNERS') where.runnerProfile = { applicationStatus: 'APPROVED' };
    if (dto.audience === 'ONLINE_RUNNERS') where.runnerProfile = { applicationStatus: 'APPROVED', isOnline: true };
    if (dto.audience === 'USERS') where.id = { in: dto.userIds ?? [] };

    const users = await this.prisma.user.findMany({ where, select: { id: true, phone: true } });
    const sent = await this.inbox.notify(
      users.map((u) => u.id),
      { title: dto.title, body: dto.body },
    );
    if (dto.sms) for (const u of users) await this.messaging.sendSms(u.phone, `${dto.title}: ${dto.body}`);
    await this.audit.log({
      actorId: admin.id,
      action: 'notification.broadcast',
      entityType: 'notification',
      metadata: { audience: dto.audience, title: dto.title, recipients: sent, sms: !!dto.sms },
    });
    return { recipients: sent };
  }
}
