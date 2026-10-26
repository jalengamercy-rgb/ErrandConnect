import { BadRequestException, Injectable } from '@nestjs/common';
import {
  areaCell,
  churnRisk,
  DELIVERY_TYPES,
  fitEtaModel,
  forecastFromHistory,
  isRunningLate,
  predictMinutes,
  RUNNER_ACTIVE_STATUSES,
  runnersNeeded,
  type ChurnRisk,
  type DeliveryType,
  type EtaModel,
} from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { Order } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MODEL_TTL_MS = HOUR_MS;
const HISTORY_WEEKS = 8;
const RUNNER_FRESH_MS = 10 * 60_000;

/** Delivery-time, demand and churn predictions for operations and marketing. */
@Injectable()
export class PredictionsService {
  private etaCache?: { at: number; models: Record<DeliveryType, EtaModel> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // ─── Delivery time ───

  /** One model per vehicle type, learnt from the last 60 days and refreshed hourly. */
  async etaModels(): Promise<Record<DeliveryType, EtaModel>> {
    if (this.etaCache && Date.now() - this.etaCache.at < MODEL_TTL_MS) return this.etaCache.models;
    const done = await this.prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: new Date(Date.now() - 60 * DAY_MS) },
        acceptedAt: { not: null },
        scheduledFor: null,
      },
      select: { deliveryType: true, distanceKm: true, acceptedAt: true, completedAt: true },
      orderBy: { completedAt: 'desc' },
      take: 20_000,
    });
    const models = Object.fromEntries(
      DELIVERY_TYPES.map((type) => [
        type,
        fitEtaModel(
          type,
          done
            .filter((o) => o.deliveryType === type)
            .map((o) => ({ distanceKm: o.distanceKm, minutes: (o.completedAt!.getTime() - o.acceptedAt!.getTime()) / 60_000 })),
        ),
      ]),
    ) as Record<DeliveryType, EtaModel>;
    this.etaCache = { at: Date.now(), models };
    return models;
  }

  async predictMinutes(order: Pick<Order, 'deliveryType' | 'distanceKm'>) {
    return predictMinutes((await this.etaModels())[order.deliveryType], order.distanceKm);
  }

  /** Errands taking clearly longer than predicted, most late first. */
  async lateErrands(now = new Date()) {
    const active = await this.prisma.order.findMany({
      where: { status: { in: [...RUNNER_ACTIVE_STATUSES] }, acceptedAt: { not: null }, predictedMinutes: { not: null } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        acceptedAt: true,
        predictedMinutes: true,
        deliveryType: true,
        distanceKm: true,
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        runner: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });
    return active
      .map((o) => {
        const elapsed = Math.round((now.getTime() - o.acceptedAt!.getTime()) / 60_000);
        return {
          ...o,
          elapsedMinutes: elapsed,
          minutesLate: elapsed - o.predictedMinutes!,
          late: isRunningLate(o.predictedMinutes!, elapsed),
        };
      })
      .filter((o) => o.late)
      .sort((a, b) => b.minutesLate - a.minutesLate);
  }

  // ─── Demand ───

  /**
   * Errands expected in each of the next `hours` hours, from the same hour on
   * the same weekday over the last 8 weeks, plus where runners will be short.
   */
  async demand(hours = 24, now = new Date()) {
    if (hours < 1 || hours > 72) throw new BadRequestException('hours must be 1 - 72');
    const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
    const history = await this.prisma.order.findMany({
      where: { createdAt: { gte: new Date(start.getTime() - HISTORY_WEEKS * 7 * DAY_MS), lt: start }, status: { not: 'AWAITING_PAYMENT' } },
      select: {
        createdAt: true,
        pickupLat: true,
        pickupLng: true,
        pickupLabel: true,
        pickupAddress: true,
        dropoffLat: true,
        dropoffLng: true,
        dropoffAddress: true,
        categorySlug: true,
      },
      take: 100_000,
    });

    // counts[hourAhead][weeksAgo-1], cells[cellKey][hourAhead][weeksAgo-1]
    const counts = Array.from({ length: hours }, () => Array.from({ length: HISTORY_WEEKS }, () => 0));
    const cells = new Map<string, { lat: number; lng: number; names: Map<string, number>; counts: number[][] }>();
    const nearHours = Math.min(3, hours);
    const categoryCounts = new Map<string, number>();
    for (const o of history) {
      const ago = start.getTime() - o.createdAt.getTime();
      const weeksAgo = Math.ceil(ago / (7 * DAY_MS));
      const hourAhead = Math.floor((weeksAgo * 7 * DAY_MS - ago) / HOUR_MS);
      if (weeksAgo < 1 || weeksAgo > HISTORY_WEEKS || hourAhead < 0 || hourAhead >= hours) continue;
      counts[hourAhead][weeksAgo - 1]++;
      categoryCounts.set(o.categorySlug, (categoryCounts.get(o.categorySlug) ?? 0) + 1);
      if (hourAhead >= nearHours) continue;
      const lat = o.pickupLat ?? o.dropoffLat;
      const lng = o.pickupLng ?? o.dropoffLng;
      const cell = areaCell(lat, lng);
      const entry = cells.get(cell.key) ?? {
        lat: cell.lat,
        lng: cell.lng,
        names: new Map(),
        counts: Array.from({ length: nearHours }, () => Array.from({ length: HISTORY_WEEKS }, () => 0)),
      };
      entry.counts[hourAhead][weeksAgo - 1]++;
      // Name the area after where errands start: the pickup if there is one.
      const name = (o.pickupLabel ?? o.pickupAddress ?? o.dropoffAddress).split(',')[0].trim();
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
      cells.set(cell.key, entry);
    }

    const runners = await this.prisma.runnerProfile.findMany({
      where: {
        applicationStatus: 'APPROVED',
        isOnline: true,
        lastSeenAt: { gte: new Date(now.getTime() - RUNNER_FRESH_MS) },
        lastLat: { not: null },
      },
      select: { lastLat: true, lastLng: true },
    });
    const onlineByCell = new Map<string, number>();
    for (const r of runners) {
      const key = areaCell(r.lastLat!, r.lastLng!).key;
      onlineByCell.set(key, (onlineByCell.get(key) ?? 0) + 1);
    }

    const forecast = counts.map((weeks, i) => {
      const at = new Date(start.getTime() + i * HOUR_MS);
      const expected = forecastFromHistory(weeks);
      return { at, expected, runnersNeeded: runnersNeeded(expected) };
    });
    const hotspots = [...cells.entries()]
      .map(([key, c]) => {
        // Busiest of the next few hours decides how many runners the area needs.
        const expected = Math.max(...c.counts.map((weeks) => forecastFromHistory(weeks)));
        const needed = runnersNeeded(expected);
        const online = onlineByCell.get(key) ?? 0;
        const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
        return {
          key,
          name,
          lat: c.lat,
          lng: c.lng,
          expectedPerHour: expected,
          runnersNeeded: needed,
          runnersOnline: online,
          shortfall: Math.max(0, needed - online),
        };
      })
      .filter((h) => h.expectedPerHour > 0)
      .sort((a, b) => b.shortfall - a.shortfall || b.expectedPerHour - a.expectedPerHour)
      .slice(0, 15);
    const categories = await this.prisma.serviceCategory.findMany({ select: { slug: true, name: true } });
    const total = [...categoryCounts.values()].reduce((s, n) => s + n, 0);
    return {
      generatedAt: now,
      basedOnWeeks: HISTORY_WEEKS,
      historyErrands: history.length,
      onlineRunners: runners.length,
      forecast,
      expectedTotal: Math.round(forecast.reduce((s, f) => s + f.expected, 0)),
      hotspots,
      topCategories: [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([slug, n]) => ({
          slug,
          name: categories.find((c) => c.slug === slug)?.name ?? slug,
          share: total ? Math.round((n / total) * 100) : 0,
        })),
    };
  }

  // ─── Churn ───

  async churnCustomers(filter?: ChurnRisk, now = new Date()) {
    const rows = await this.prisma.$queryRaw<
      {
        user_id: string;
        first_name: string;
        last_name: string;
        phone: string;
        orders: number;
        first_at: Date;
        last_at: Date;
        spend: number;
      }[]
    >`
      SELECT o.customer_id AS user_id, u.first_name, u.last_name, u.phone, COUNT(*)::int AS orders,
             MIN(o.completed_at) AS first_at, MAX(o.completed_at) AS last_at, COALESCE(SUM(o.total), 0)::int AS spend
        FROM orders o JOIN users u ON u.id = o.customer_id
       WHERE o.status = 'COMPLETED' AND o.business_id IS NULL AND u.status = 'ACTIVE'
       GROUP BY 1, 2, 3, 4
      HAVING MAX(o.completed_at) <= ${new Date(now.getTime() - 14 * DAY_MS)}`;
    const items = rows
      .map((r) => {
        const daysSinceLast = Math.floor((now.getTime() - r.last_at.getTime()) / DAY_MS);
        const avgGapDays = r.orders > 1 ? (r.last_at.getTime() - r.first_at.getTime()) / DAY_MS / (r.orders - 1) : null;
        const { risk, ratio } = churnRisk(r.orders, daysSinceLast, avgGapDays);
        return {
          userId: r.user_id,
          name: `${r.first_name} ${r.last_name}`,
          phone: r.phone,
          orders: r.orders,
          lifetimeSpend: r.spend,
          lastOrderAt: r.last_at,
          daysSinceLast,
          usualGapDays: avgGapDays === null ? null : Math.round(avgGapDays),
          risk,
          ratio,
        };
      })
      .filter((c) => c.risk !== 'ACTIVE' && (!filter || c.risk === filter))
      // Most valuable customers first: they're worth winning back.
      .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend);
    const byRisk = { AT_RISK: 0, LIKELY_LOST: 0, LOST: 0 } as Record<Exclude<ChurnRisk, 'ACTIVE'>, number>;
    for (const c of items) byRisk[c.risk as Exclude<ChurnRisk, 'ACTIVE'>]++;
    return { counts: byRisk, items: items.slice(0, 500) };
  }

  /** Approved runners who were busy but have stopped taking jobs. */
  async inactiveRunners(now = new Date()) {
    const rows = await this.prisma.$queryRaw<
      { user_id: string; first_name: string; last_name: string; phone: string; jobs: number; last_at: Date }[]
    >`
      SELECT o.runner_id AS user_id, u.first_name, u.last_name, u.phone, COUNT(*)::int AS jobs, MAX(o.completed_at) AS last_at
        FROM orders o JOIN users u ON u.id = o.runner_id
        JOIN runner_profiles rp ON rp.user_id = o.runner_id AND rp.application_status = 'APPROVED'
       WHERE o.status = 'COMPLETED' AND o.completed_at >= ${new Date(now.getTime() - 60 * DAY_MS)} AND u.status = 'ACTIVE'
       GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) >= 5 AND MAX(o.completed_at) <= ${new Date(now.getTime() - 14 * DAY_MS)}
       ORDER BY COUNT(*) DESC LIMIT 500`;
    return rows.map((r) => ({
      userId: r.user_id,
      name: `${r.first_name} ${r.last_name}`,
      phone: r.phone,
      jobsLast60Days: r.jobs,
      lastJobAt: r.last_at,
      daysSinceLast: Math.floor((now.getTime() - r.last_at.getTime()) / DAY_MS),
    }));
  }

  /** Sends a "we miss you" message (optionally with a promo code) to chosen people. */
  async winBack(userIds: string[], title: string, message: string, promoCode: string | undefined, admin: AuthUser) {
    let body = message;
    if (promoCode) {
      const promo = await this.prisma.promoCode.findUnique({ where: { code: promoCode.toUpperCase() } });
      if (!promo || !promo.isActive || (promo.endsAt && promo.endsAt <= new Date()))
        throw new BadRequestException('That promo code is not active');
      body = `${message}\n\nUse code ${promo.code}: ${promo.description}`;
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' }, select: { id: true } });
    const sent = await this.inbox.notify(
      users.map((u) => u.id),
      { title, body, link: '/' },
    );
    await this.audit.log({
      actorId: admin.id,
      action: 'insights.win_back',
      entityType: 'user',
      metadata: { sent, promoCode: promoCode ?? null, title },
    });
    return { sent };
  }
}
