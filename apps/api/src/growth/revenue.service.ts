import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface FeeTotals {
  orders: number;
  commission: number;
  delivery_margin: number;
  urgency_margin: number;
  surge_margin: number;
  service_fees: number;
  discounts: number;
}

/** Where the platform's money comes from, for the finance revenue report. */
@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async report(fromIso: string, toIso: string) {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (to <= from) throw new BadRequestException('"to" must be after "from"');

    // Order fees, from the quote saved on each order completed in the period.
    const fee = (key: string) => `COALESCE(SUM((pricing_snapshot->'quote'->'platform'->>'${key}')::int), 0)::int`;
    const [orderFees] = await this.prisma.$queryRawUnsafe<FeeTotals[]>(
      `SELECT COUNT(*)::int AS orders, ${fee('commission')} AS commission, ${fee('deliveryMargin')} AS delivery_margin,
              ${fee('urgencyMargin')} AS urgency_margin, ${fee('surgeMargin')} AS surge_margin, ${fee('serviceFee')} AS service_fees,
              COALESCE(SUM(discount), 0)::int AS discounts
         FROM orders WHERE status = 'COMPLETED' AND completed_at >= $1 AND completed_at < $2`,
      from,
      to,
    );

    // Everything that reached or left the platform revenue wallet, by kind.
    const ledger = await this.prisma.$queryRaw<{ type: string; amount: number }[]>`
      SELECT t.type::text AS type, COALESCE(SUM(e.amount), 0)::int AS amount
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e.transaction_id
        JOIN wallets w ON w.id = e.wallet_id
       WHERE w.type = 'PLATFORM_REVENUE' AND e.created_at >= ${from} AND e.created_at < ${to}
       GROUP BY t.type`;
    const byType = Object.fromEntries(ledger.map((l) => [l.type, l.amount]));
    const net = ledger.reduce((sum, l) => sum + l.amount, 0);

    const [plusMembers, promoUses] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } } }),
      this.prisma.promoRedemption.count({ where: { createdAt: { gte: from, lt: to }, order: { status: 'COMPLETED' } } }),
    ]);

    return {
      from,
      to,
      completedOrders: orderFees.orders,
      streams: [
        { key: 'commission', label: 'Errand commission', amount: orderFees.commission },
        { key: 'deliveryMargin', label: 'Delivery fee margin', amount: orderFees.delivery_margin },
        { key: 'urgencyMargin', label: 'Urgency fee margin', amount: orderFees.urgency_margin },
        { key: 'surgeMargin', label: 'Surge fee margin', amount: orderFees.surge_margin },
        { key: 'serviceFees', label: 'Service fees', amount: orderFees.service_fees },
        { key: 'merchantCommission', label: 'Shop commission', amount: byType.MERCHANT_COMMISSION ?? 0 },
        { key: 'subscriptions', label: 'ErrandCONNECT Plus', amount: byType.SUBSCRIPTION ?? 0 },
        { key: 'featuredListings', label: 'Featured shop listings', amount: byType.FEATURED_LISTING ?? 0 },
        { key: 'advertising', label: 'Advertising', amount: byType.ADVERTISING ?? 0 },
      ],
      costs: [
        { key: 'discounts', label: 'Promo discounts', amount: orderFees.discounts },
        { key: 'referrals', label: 'Referral rewards', amount: -(byType.REFERRAL_REWARD ?? 0) },
        { key: 'loyalty', label: 'Loyalty redemptions', amount: -(byType.LOYALTY_REDEMPTION ?? 0) },
        { key: 'credits', label: 'Goodwill credits (disputes)', amount: -(byType.BONUS ?? 0) },
      ],
      /** What actually reached the revenue wallet in the period (all streams minus all costs). */
      net,
      plusMembers,
      promoUses,
    };
  }
}
