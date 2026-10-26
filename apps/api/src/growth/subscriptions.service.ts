import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLUS_BENEFITS, PLUS_PERIOD_DAYS } from '@errandconnect/shared';
import type { Prisma, Subscription } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { InsufficientFundsException, LedgerService } from '../payments/ledger.service.js';
import { MpesaClient, MpesaError } from '../payments/mpesa/mpesa.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GrowthSettingsService } from './growth-settings.service.js';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const RENEWAL_CHECK_MS = 60 * 60_000;

/** ErrandCONNECT Plus: no service fee and double loyalty points for 30 days at a time. */
@Injectable()
export class SubscriptionsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Subscriptions');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly mpesa: MpesaClient,
    private readonly settings: GrowthSettingsService,
    private readonly inbox: InboxService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    // Tests call renewDue() themselves.
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.renewDue().catch((e: Error) => this.logger.error(e.message)), RENEWAL_CHECK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async isPlus(userId: string, at = new Date()) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    return !!sub && sub.status === 'ACTIVE' && !!sub.currentPeriodEnd && sub.currentPeriodEnd > at;
  }

  async get(userId: string) {
    const [sub, config] = await Promise.all([this.prisma.subscription.findUnique({ where: { userId } }), this.settings.get()]);
    const active = !!sub && sub.status === 'ACTIVE' && !!sub.currentPeriodEnd && sub.currentPeriodEnd > new Date();
    const pending =
      sub?.status === 'PENDING'
        ? await this.prisma.payment.findFirst({ where: { subscriptionId: sub.id }, orderBy: { createdAt: 'desc' } })
        : null;
    return {
      available: config.plus.enabled,
      price: config.plus.monthlyPrice,
      periodDays: PLUS_PERIOD_DAYS,
      benefits: PLUS_BENEFITS,
      active,
      status: sub?.status ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      autoRenew: sub?.autoRenew ?? false,
      pendingPayment: pending && { status: pending.status, failureReason: pending.failureReason },
    };
  }

  /** Join (or renew early) by wallet or M-Pesa. */
  async subscribe(userId: string, method: 'WALLET' | 'MPESA', phone?: string) {
    const config = await this.settings.get();
    if (!config.plus.enabled) throw new BadRequestException('ErrandCONNECT Plus is not available right now');
    const price = config.plus.monthlyPrice;
    const existing = await this.prisma.subscription.findUnique({ where: { userId } });
    if (existing?.status === 'ACTIVE' && existing.currentPeriodEnd && existing.currentPeriodEnd.getTime() - Date.now() > 3 * DAY_MS) {
      throw new ConflictException('You are already a Plus member. You can renew in the last 3 days of your month');
    }
    const sub = existing
      ? await this.prisma.subscription.update({ where: { userId }, data: { price, autoRenew: true, cancelledAt: null } })
      : await this.prisma.subscription.create({ data: { userId, price } });

    if (method === 'WALLET') {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await this.ledger.userWallet(tx, userId, 'CUSTOMER');
        await this.charge(tx, sub, wallet.id, price, `plus:${sub.id}:${Date.now()}`, true);
      });
      return this.get(userId);
    }

    const to = phone ?? (await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } })).phone;
    try {
      const response = await this.mpesa.stkPush({ phone: to, amount: price, accountReference: 'PLUS', description: 'ErrandCONNECT Plus' });
      await this.prisma.payment.create({
        data: { subscriptionId: sub.id, provider: 'MPESA', amount: price, phone: to, providerRequestId: response.checkoutRequestId },
      });
    } catch (error) {
      if (error instanceof MpesaError) throw new BadRequestException(error.message);
      throw error;
    }
    return { ...(await this.get(userId)), message: 'Check your phone and enter your M-Pesa PIN to join Plus' };
  }

  /** M-Pesa confirmed a Plus payment (called from the payments callback). */
  async settleMpesa(tx: Tx, subscriptionId: string, amount: number, receipt: string, checkoutRequestId: string) {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const clearing = await this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING');
    if (amount < sub.price) {
      // Paid too little: keep the money as wallet credit rather than lose it.
      const wallet = await this.ledger.userWallet(tx, sub.userId, 'CUSTOMER');
      await this.ledger.post(tx, {
        type: 'PAYMENT_IN',
        description: `M-Pesa ${receipt} (short payment for Plus)`,
        idempotencyKey: `stk:${checkoutRequestId}`,
        entries: [
          { walletId: clearing.id, amount: -amount },
          { walletId: wallet.id, amount },
        ],
      });
      return;
    }
    await this.charge(tx, sub, clearing.id, amount, `stk:${checkoutRequestId}`, false, receipt);
  }

  /** Books the payment and starts (or extends) the period. */
  private async charge(
    tx: Tx,
    sub: Subscription,
    fromWalletId: string,
    amount: number,
    key: string,
    fromWallet: boolean,
    receipt = '',
    now = new Date(),
  ) {
    const platform = await this.ledger.systemWallet(tx, 'PLATFORM_REVENUE');
    try {
      await this.ledger.post(tx, {
        type: 'SUBSCRIPTION',
        description: `ErrandCONNECT Plus ${receipt}`.trim(),
        idempotencyKey: key,
        entries: [
          { walletId: fromWalletId, amount: -amount, noOverdraft: fromWallet },
          { walletId: platform.id, amount },
        ],
      });
    } catch (error) {
      if (error instanceof InsufficientFundsException)
        throw new BadRequestException(`You need KES ${amount} in your wallet to pay for Plus`);
      throw error;
    }
    const stillActive = sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd > now;
    const start = stillActive ? sub.currentPeriodStart! : now;
    const end = new Date((stillActive ? sub.currentPeriodEnd!.getTime() : now.getTime()) + PLUS_PERIOD_DAYS * DAY_MS);
    await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end } });
  }

  async setAutoRenew(userId: string, autoRenew: boolean) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub || sub.status !== 'ACTIVE') throw new BadRequestException('You are not a Plus member');
    await this.prisma.subscription.update({ where: { userId }, data: { autoRenew, cancelledAt: autoRenew ? null : new Date() } });
    return this.get(userId);
  }

  /** Renews ended periods from the wallet, or ends membership. Runs hourly. */
  async renewDue(now = new Date()) {
    const due = await this.prisma.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } }, take: 500 });
    const price = (await this.settings.get()).plus.monthlyPrice;
    let renewed = 0;
    for (const sub of due) {
      try {
        if (!sub.autoRenew) throw new BadRequestException('not renewing');
        await this.prisma.$transaction(async (tx) => {
          const wallet = await this.ledger.userWallet(tx, sub.userId, 'CUSTOMER');
          // Expire first so charge() starts a fresh period from now.
          const expired = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED', price } });
          await this.charge(tx, expired, wallet.id, price, `plus-renew:${sub.id}:${sub.currentPeriodEnd!.toISOString()}`, true, '', now);
        });
        renewed++;
        await this.inbox.notify([sub.userId], {
          title: 'Plus renewed',
          body: `KES ${price} was paid from your wallet for another ${PLUS_PERIOD_DAYS} days.`,
          link: '/plus',
        });
      } catch {
        await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
        await this.inbox.notify([sub.userId], {
          title: 'Your Plus membership ended',
          body: sub.autoRenew ? `We couldn't renew from your wallet (KES ${price} needed). Join again any time.` : 'Join again any time.',
          link: '/plus',
        });
      }
    }
    return { checked: due.length, renewed };
  }
}
