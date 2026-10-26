import { BadRequestException, Injectable } from '@nestjs/common';
import { loyaltyPointsFor, loyaltyTierFor, loyaltyValueFor } from '@errandconnect/shared';
import type { Order, Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { LedgerService } from '../payments/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GrowthSettingsService } from './growth-settings.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

type Tx = Prisma.TransactionClient;

interface Reward {
  userId: string;
  title: string;
  body: string;
}

/** Loyalty points and referral rewards, given when an errand is completed. */
@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: GrowthSettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * Call inside the transaction that completes the order. Returns messages to
   * send once it commits. Safe to call twice: everything is keyed by order or user.
   */
  async onOrderCompleted(tx: Tx, order: Order): Promise<Reward[]> {
    const config = await this.settings.get();
    const rewards: Reward[] = [];

    // Loyalty: personal errands only (company spending isn't the employee's).
    if (!order.businessId && config.loyalty.enabled) {
      const points = loyaltyPointsFor(order.total, config.loyalty, await this.subscriptions.isPlus(order.customerId));
      const exists = await tx.loyaltyEvent.findUnique({ where: { orderId: order.id } });
      if (points > 0 && !exists) {
        await tx.loyaltyEvent.create({
          data: { userId: order.customerId, orderId: order.id, points, reason: `Errand ${order.orderNumber}` },
        });
        await tx.customerProfile.update({
          where: { userId: order.customerId },
          data: { loyaltyPoints: { increment: points }, lifetimePoints: { increment: points } },
        });
        rewards.push({ userId: order.customerId, title: `+${points} loyalty points`, body: `For errand ${order.orderNumber}.` });
      }
    }

    // Referral: the first completed errand of an invited user, as customer or runner.
    if (config.referral.enabled) {
      for (const userId of [order.customerId, order.runnerId]) {
        if (userId) rewards.push(...(await this.referralReward(tx, userId, config.referral)));
      }
    }
    return rewards;
  }

  notify(rewards: Reward[]) {
    return Promise.all(rewards.map((r) => this.inbox.notify([r.userId], { title: r.title, body: r.body, link: '/rewards' })));
  }

  private async referralReward(tx: Tx, userId: string, referral: { referrerReward: number; refereeReward: number }): Promise<Reward[]> {
    // Claim the reward first so it's only ever paid once.
    const { count } = await tx.user.updateMany({
      where: { id: userId, referredById: { not: null }, referralRewardedAt: null },
      data: { referralRewardedAt: new Date() },
    });
    if (count === 0) return [];
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, referredById: true } });
    const rewards: Reward[] = [];
    const pay = async (to: string, amount: number, key: string, description: string) => {
      if (amount <= 0) return;
      const [platform, wallet] = await Promise.all([
        this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
        this.ledger.userWallet(tx, to, 'CUSTOMER'),
      ]);
      await this.ledger.post(tx, {
        type: 'REFERRAL_REWARD',
        description,
        idempotencyKey: key,
        entries: [
          { walletId: platform.id, amount: -amount },
          { walletId: wallet.id, amount },
        ],
      });
    };
    await pay(user.referredById!, referral.referrerReward, `referral:${userId}:referrer`, `Referral reward: ${user.firstName} joined`);
    await pay(userId, referral.refereeReward, `referral:${userId}:referee`, 'Welcome reward for joining with a referral code');
    if (referral.referrerReward > 0) {
      rewards.push({
        userId: user.referredById!,
        title: `You earned KES ${referral.referrerReward}`,
        body: `${user.firstName} completed their first errand with your referral code. The money is in your wallet.`,
      });
    }
    if (referral.refereeReward > 0) {
      rewards.push({
        userId,
        title: `Welcome bonus: KES ${referral.refereeReward}`,
        body: 'Thanks for joining with a referral code. The money is in your wallet.',
      });
    }
    return rewards;
  }

  // ─── Customer screens ───

  async summary(userId: string) {
    const [config, profile, user, invited, rewarded, history] = await Promise.all([
      this.settings.get(),
      this.prisma.customerProfile.findUnique({ where: { userId }, select: { loyaltyPoints: true, lifetimePoints: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
      this.prisma.loyaltyEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, omit: { userId: true } }),
    ]);
    const points = profile?.loyaltyPoints ?? 0;
    return {
      loyalty: {
        enabled: config.loyalty.enabled,
        points,
        lifetimePoints: profile?.lifetimePoints ?? 0,
        ...loyaltyTierFor(profile?.lifetimePoints ?? 0),
        pointsPer100: config.loyalty.pointsPer100,
        valuePer100Points: config.loyalty.valuePer100Points,
        minRedeemPoints: config.loyalty.minRedeemPoints,
        redeemableValue: points >= config.loyalty.minRedeemPoints ? loyaltyValueFor(points, config.loyalty).amount : 0,
        history,
      },
      referral: {
        enabled: config.referral.enabled,
        code: user.referralCode,
        referrerReward: config.referral.referrerReward,
        refereeReward: config.referral.refereeReward,
        invited,
        rewarded,
        earned: rewarded * config.referral.referrerReward,
      },
    };
  }

  /** Turns points into wallet credit. */
  async redeem(userId: string, requested: number) {
    const config = await this.settings.get();
    if (!config.loyalty.enabled) throw new BadRequestException('Loyalty points are paused right now');
    if (requested < config.loyalty.minRedeemPoints)
      throw new BadRequestException(`Redeem at least ${config.loyalty.minRedeemPoints} points`);
    const { points, amount } = loyaltyValueFor(requested, config.loyalty);
    if (amount <= 0) throw new BadRequestException('These points are not worth anything yet');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customerProfile.updateMany({
        where: { userId, loyaltyPoints: { gte: points } },
        data: { loyaltyPoints: { decrement: points } },
      });
      if (count === 0) throw new BadRequestException('You do not have that many points');
      const event = await tx.loyaltyEvent.create({ data: { userId, points: -points, reason: `Redeemed for KES ${amount}` } });
      const [platform, wallet] = await Promise.all([
        this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
        this.ledger.userWallet(tx, userId, 'CUSTOMER'),
      ]);
      await this.ledger.post(tx, {
        type: 'LOYALTY_REDEMPTION',
        description: `${points} loyalty points redeemed`,
        idempotencyKey: `loyalty:${event.id}`,
        entries: [
          { walletId: platform.id, amount: -amount },
          { walletId: wallet.id, amount },
        ],
      });
    });
    return { redeemed: points, amount, ...(await this.summary(userId)) };
  }
}
