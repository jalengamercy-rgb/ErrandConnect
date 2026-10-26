import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isoWeekKey, RISK_LIMITS as L, RISK_RULES, riskScore, type RiskRule } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { Order, Prisma, RiskFlagStatus, RiskSeverity } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
const SCAN_EVERY_MS = 60 * 60_000;

interface Finding {
  rule: RiskRule;
  userId?: string | null;
  orderId?: string;
  summary: string;
  details?: Prisma.InputJsonValue;
  /** How many times over the limit, for the score. */
  times?: number;
  severity?: RiskSeverity;
}

/**
 * Fraud and abuse rules. Findings become risk flags that staff review;
 * nothing is blocked automatically except holding big-risk withdrawals for review.
 */
@Injectable()
export class RiskService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Risk');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.scan().catch((e: Error) => this.logger.error(e.message)), SCAN_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Records a finding once per subject per week. Reviewed flags are left alone. */
  async raise(f: Finding, now = new Date()) {
    const severity = f.severity ?? RISK_RULES[f.rule].severity;
    const subject = f.orderId ?? f.userId ?? 'platform';
    const dedupeKey = `${f.rule}:${subject}:${f.orderId ? 'order' : isoWeekKey(now)}`;
    const score = riskScore(severity, f.times);
    const existing = await this.prisma.riskFlag.findUnique({ where: { dedupeKey } });
    if (existing) {
      if (existing.status === 'OPEN') {
        await this.prisma.riskFlag.update({
          where: { id: existing.id },
          data: { score: Math.max(score, existing.score), summary: f.summary, details: f.details, severity },
        });
      }
      return existing;
    }
    return this.prisma.riskFlag.create({
      data: { rule: f.rule, severity, score, summary: f.summary, details: f.details, userId: f.userId, orderId: f.orderId, dedupeKey },
    });
  }

  /** Withdrawals from people with an open high-risk flag wait for finance. */
  async hasOpenHighRisk(userId: string) {
    return (await this.prisma.riskFlag.count({ where: { userId, status: 'OPEN', severity: 'HIGH' } })) > 0;
  }

  // ─── Checks that run as things happen ───

  async onOrderCreated(order: Order) {
    const user = await this.prisma.user.findUnique({ where: { id: order.customerId }, select: { createdAt: true } });
    if (!user || order.businessId) return;
    const ageHours = (order.createdAt.getTime() - user.createdAt.getTime()) / 3_600_000;
    if (ageHours < L.newAccountHours && order.total >= L.newAccountBigOrder) {
      await this.raise({
        rule: 'NEW_ACCOUNT_BIG_ORDER',
        userId: order.customerId,
        orderId: order.id,
        summary: `KES ${order.total.toLocaleString('en-KE')} errand from an account created ${Math.max(0, Math.round(ageHours))} hours ago`,
        details: { total: order.total, accountAgeHours: Math.round(ageHours * 10) / 10, paymentMethod: order.paymentMethod },
      });
    }
  }

  async onDelivered(order: Order, runnerId: string, distanceKm: number | null) {
    if (distanceKm === null || distanceKm <= L.farFromDropoffKm) return;
    await this.raise({
      rule: 'FAR_FROM_DROPOFF',
      userId: runnerId,
      orderId: order.id,
      summary: `Delivery PIN entered ${distanceKm.toFixed(1)} km from the drop-off for ${order.orderNumber}`,
      details: { distanceKm, orderNumber: order.orderNumber },
      times: distanceKm / L.farFromDropoffKm,
    });
  }

  // ─── Periodic scan ───

  async scan(now = new Date()) {
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const findings: Finding[] = [];

    const cancels = await this.prisma.$queryRaw<{ user_id: string; n: number }[]>`
      SELECT o.customer_id AS user_id, COUNT(*)::int AS n
        FROM orders o JOIN order_events e ON e.order_id = o.id AND e.status = 'CANCELLED' AND e.actor_id = o.customer_id
       WHERE o.runner_id IS NOT NULL AND e.created_at >= ${since(30)}
       GROUP BY 1 HAVING COUNT(*) >= ${L.cancelsAfterAccept30d}`;
    for (const c of cancels) {
      findings.push({
        rule: 'CUSTOMER_CANCELS',
        userId: c.user_id,
        summary: `Cancelled ${c.n} errands after a runner accepted (30 days)`,
        details: { cancellations: c.n },
        times: c.n / L.cancelsAfterAccept30d,
      });
    }

    const disputes = await this.prisma.dispute.groupBy({
      by: ['raisedById'],
      where: { createdAt: { gte: since(30) } },
      _count: true,
      having: { raisedById: { _count: { gte: L.disputes30d } } },
    });
    for (const d of disputes) {
      findings.push({
        rule: 'DISPUTE_HEAVY',
        userId: d.raisedById,
        summary: `Reported ${d._count} problems in 30 days`,
        details: { disputes: d._count },
        severity: d._count >= L.disputesHigh30d ? 'HIGH' : 'MEDIUM',
        times: d._count / L.disputes30d,
      });
    }

    const releases = await this.prisma.orderEvent.groupBy({
      by: ['actorId'],
      where: { createdAt: { gte: since(7) }, note: { startsWith: 'Runner released the job' } },
      _count: true,
      having: { actorId: { _count: { gte: L.releases7d } } },
    });
    for (const r of releases) {
      findings.push({
        rule: 'RUNNER_RELEASES',
        userId: r.actorId,
        summary: `Handed back ${r._count} jobs in 7 days`,
        details: { releases: r._count },
        times: r._count / L.releases7d,
      });
    }

    const pins = await this.prisma.order.groupBy({
      by: ['runnerId'],
      where: { pinAttempts: { gte: 3 }, updatedAt: { gte: since(30) }, runnerId: { not: null } },
      _count: true,
      having: { runnerId: { _count: { gte: L.wrongPinOrders30d } } },
    });
    for (const p of pins) {
      findings.push({
        rule: 'PIN_GUESSING',
        userId: p.runnerId,
        summary: `3+ wrong delivery PINs on ${p._count} errands (30 days)`,
        details: { errands: p._count },
        times: p._count / L.wrongPinOrders30d,
      });
    }

    const far = await this.prisma.order.groupBy({
      by: ['runnerId'],
      where: { deliveryDistanceKm: { gt: L.farFromDropoffKm }, completedAt: { gte: since(30) }, runnerId: { not: null } },
      _count: true,
      having: { runnerId: { _count: { gte: L.farDeliveries30d } } },
    });
    for (const f of far) {
      findings.push({
        rule: 'FAR_FROM_DROPOFF',
        userId: f.runnerId,
        summary: `${f._count} deliveries confirmed more than ${L.farFromDropoffKm} km from the drop-off (30 days)`,
        details: { deliveries: f._count },
        severity: 'HIGH',
        times: f._count / L.farDeliveries30d,
      });
    }

    const lowRated = await this.prisma.runnerProfile.findMany({
      where: { applicationStatus: 'APPROVED', ratingAvg: { lt: L.lowRating, gt: 0 }, ratingCount: { gte: L.lowRatingMinReviews } },
      select: { userId: true, ratingAvg: true, ratingCount: true },
    });
    for (const r of lowRated) {
      findings.push({
        rule: 'LOW_RATED_RUNNER',
        userId: r.userId,
        summary: `Average rating ${r.ratingAvg.toFixed(1)} from ${r.ratingCount} reviews`,
        details: { rating: r.ratingAvg, reviews: r.ratingCount },
      });
    }

    const referrals = await this.prisma.user.groupBy({
      by: ['referredById'],
      where: { referralRewardedAt: { gte: since(7) }, referredById: { not: null } },
      _count: true,
      having: { referredById: { _count: { gte: L.referralRewards7d } } },
    });
    for (const r of referrals) {
      findings.push({
        rule: 'REFERRAL_BURST',
        userId: r.referredById,
        summary: `${r._count} referral rewards in 7 days`,
        details: { rewards: r._count },
        times: r._count / L.referralRewards7d,
      });
    }

    const sharedIp = await this.prisma.$queryRaw<{ promo_id: string; code: string; ip: string; users: string[] }[]>`
      SELECT pr.promo_id, pc.code, s.ip_address AS ip, ARRAY_AGG(DISTINCT pr.user_id) AS users
        FROM promo_redemptions pr
        JOIN promo_codes pc ON pc.id = pr.promo_id
        JOIN users u ON u.id = pr.user_id AND u.created_at >= ${since(30)}
        JOIN sessions s ON s.user_id = pr.user_id AND s.ip_address IS NOT NULL
       WHERE pr.created_at >= ${since(30)}
       GROUP BY 1, 2, 3 HAVING COUNT(DISTINCT pr.user_id) >= ${L.sharedIpPromoAccounts}`;
    for (const g of sharedIp) {
      for (const userId of g.users) {
        findings.push({
          rule: 'SHARED_IP_PROMO',
          userId,
          summary: `${g.users.length} new accounts used code ${g.code} from the same network`,
          details: { code: g.code, ip: g.ip, accounts: g.users },
          times: g.users.length / L.sharedIpPromoAccounts,
        });
      }
    }

    const failures = await this.prisma.$queryRaw<{ user_id: string; n: number }[]>`
      SELECT o.customer_id AS user_id, COUNT(*)::int AS n
        FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.status IN ('FAILED', 'CANCELLED') AND p.created_at >= ${since(1)}
       GROUP BY 1 HAVING COUNT(*) >= ${L.paymentFailures24h}`;
    for (const f of failures) {
      findings.push({
        rule: 'PAYMENT_FAILURES',
        userId: f.user_id,
        summary: `${f.n} failed M-Pesa payments in 24 hours`,
        details: { failures: f.n },
      });
    }

    const pairs = await this.prisma.order.groupBy({
      by: ['runnerId', 'customerId'],
      where: { status: 'COMPLETED', completedAt: { gte: since(7) }, runnerId: { not: null }, businessId: null },
      _count: true,
      having: { runnerId: { _count: { gte: L.samePairOrders7d } } },
    });
    for (const p of pairs) {
      findings.push({
        rule: 'SAME_PAIR',
        userId: p.runnerId,
        summary: `Completed ${p._count} errands for the same customer in 7 days`,
        details: { customerId: p.customerId, errands: p._count },
        times: p._count / L.samePairOrders7d,
      });
    }

    for (const f of findings) await this.raise(f, now);
    return { findings: findings.length };
  }

  // ─── Review queue ───

  async list(query: { status?: RiskFlagStatus; severity?: RiskSeverity; userId?: string; page: number; pageSize: number }) {
    const where: Prisma.RiskFlagWhereInput = { status: query.status, severity: query.severity, userId: query.userId };
    const [total, items] = await Promise.all([
      this.prisma.riskFlag.count({ where }),
      this.prisma.riskFlag.findMany({
        where,
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              status: true,
              runnerProfile: { select: { runnerCode: true } },
            },
          },
          order: { select: { id: true, orderNumber: true } },
          reviewedBy: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: items.map((f) => ({ ...f, title: RISK_RULES[f.rule as RiskRule]?.title ?? f.rule })),
    };
  }

  async review(id: string, decision: 'CONFIRMED' | 'DISMISSED', note: string | undefined, admin: AuthUser) {
    const flag = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('Flag not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.riskFlag.update({
        where: { id },
        data: { status: decision, reviewNote: note, reviewedById: admin.id, reviewedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: `risk.${decision.toLowerCase()}`,
          entityType: 'risk_flag',
          entityId: id,
          metadata: { rule: flag.rule, note: note ?? null },
        },
        tx,
      );
      return updated;
    });
  }
}
