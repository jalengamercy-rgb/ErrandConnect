import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AUTO_APPROVE_WITHDRAWAL_LIMIT, MAX_WITHDRAWAL, MIN_WITHDRAWAL } from '@errandconnect/shared';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../common/auth-user.js';
import { AuditService } from '../common/audit.service.js';
import { verifySecret } from '../common/crypto.js';
import type { Prisma, Withdrawal } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RiskService } from '../insights/risk.service.js';
import { LedgerService } from './ledger.service.js';
import { MpesaClient, MpesaError, parseB2cCallback } from './mpesa/mpesa.client.js';

type Tx = Prisma.TransactionClient;
type WalletOwnerType = 'CUSTOMER' | 'RUNNER';

/**
 * Withdrawals from a wallet to M-Pesa (or bank, paid manually by finance).
 * Requesting moves the money into PAYOUT_PENDING so it can't be spent twice;
 * a successful payout moves it out to M-Pesa, a failure or rejection returns it.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly mpesa: MpesaClient,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly risk: RiskService,
  ) {}

  async request(userId: string, walletType: WalletOwnerType, amount: number, pin: string) {
    if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
      throw new BadRequestException(`Withdraw between KES ${MIN_WITHDRAWAL} and KES ${MAX_WITHDRAWAL.toLocaleString('en-KE')}`);
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        phone: true,
        pinHash: true,
        runnerProfile: { select: { applicationStatus: true } },
        payoutMethods: { where: { isDefault: true }, take: 1 },
      },
    });
    if (!(await verifySecret(pin, user.pinHash))) throw new UnauthorizedException('Incorrect security PIN');

    // Where the money goes. Customers can only withdraw to their own number;
    // runners use the payout account checked during registration.
    let method: 'MPESA' | 'BANK' = 'MPESA';
    let destination: Record<string, string | null> = { phone: user.phone };
    if (walletType === 'RUNNER') {
      const payout = user.payoutMethods[0];
      if (user.runnerProfile?.applicationStatus !== 'APPROVED' || !payout || payout.status !== 'APPROVED') {
        throw new ForbiddenException('Your payout account must be approved before you can withdraw');
      }
      method = payout.type === 'BANK' ? 'BANK' : 'MPESA';
      destination =
        method === 'BANK'
          ? { accountName: payout.accountName, bankName: payout.bankName, accountNumber: payout.accountNumber, branch: payout.branch }
          : { accountName: payout.accountName, phone: payout.phone };
    }

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { type_userId: { type: walletType, userId } } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      const created = await tx.withdrawal.create({ data: { walletId: wallet.id, amount, method, destination } });
      const pending = await this.ledger.systemWallet(tx, 'PAYOUT_PENDING');
      await this.ledger.post(tx, {
        type: 'WITHDRAWAL',
        description: method === 'BANK' ? 'Withdrawal to bank' : 'Withdrawal to M-Pesa',
        idempotencyKey: `withdraw-hold:${created.id}`,
        entries: [
          { walletId: wallet.id, amount: -amount, noOverdraft: true },
          { walletId: pending.id, amount },
        ],
      });
      return created;
    });

    // Small M-Pesa withdrawals are paid at once, unless a high-risk flag is open on the account.
    if (method === 'MPESA' && amount <= AUTO_APPROVE_WITHDRAWAL_LIMIT && !(await this.risk.hasOpenHighRisk(userId))) {
      return this.sendPayout(withdrawal);
    }
    return this.view(withdrawal.id);
  }

  /** Starts the M-Pesa B2C payout. The result arrives later in handleB2cResult. */
  private async sendPayout(withdrawal: Withdrawal, reviewedById?: string) {
    const phone = (withdrawal.destination as { phone?: string }).phone;
    if (withdrawal.method !== 'MPESA' || !phone) throw new BadRequestException('Bank withdrawals are paid manually by finance');
    try {
      const response = await this.mpesa.b2c({
        phone,
        amount: withdrawal.amount,
        originatorConversationId: randomUUID(),
        remarks: `ErrandCONNECT withdrawal ${withdrawal.id.slice(0, 8)}`,
      });
      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'APPROVED', providerReference: response.conversationId, reviewedById },
      });
    } catch (error) {
      const reason = error instanceof MpesaError ? error.message : 'Payout could not be sent';
      this.logger.error(`B2C for withdrawal ${withdrawal.id} failed`, error);
      await this.prisma.$transaction((tx) => this.returnFunds(tx, withdrawal, 'FAILED', reason));
    }
    return this.view(withdrawal.id);
  }

  /** Safaricom's answer to a B2C payout. Safe to receive more than once. */
  async handleB2cResult(body: unknown) {
    const result = parseB2cCallback(body);
    if (!result) {
      this.logger.warn('Ignoring unreadable B2C result');
      return;
    }
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { providerReference: result.conversationId },
      include: { wallet: true },
    });
    if (!withdrawal || withdrawal.status !== 'APPROVED') return;

    await this.prisma.$transaction(async (tx) => {
      if (result.resultCode !== 0) {
        await this.returnFunds(tx, withdrawal, 'FAILED', result.resultDesc);
        return;
      }
      const { count } = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: 'APPROVED' },
        data: { status: 'PAID', providerReceipt: result.transactionId },
      });
      if (count === 0) return;
      const [pending, clearing] = await Promise.all([
        this.ledger.systemWallet(tx, 'PAYOUT_PENDING'),
        this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
      ]);
      await this.ledger.post(tx, {
        type: 'WITHDRAWAL',
        description: `Withdrawal paid ${result.transactionId ?? ''}`.trim(),
        idempotencyKey: `withdraw-paid:${withdrawal.id}`,
        entries: [
          { walletId: pending.id, amount: -withdrawal.amount },
          { walletId: clearing.id, amount: withdrawal.amount },
        ],
      });
    });
    this.realtime.toUsers([withdrawal.wallet.userId], 'wallet.updated', { withdrawalId: withdrawal.id });
  }

  /** Puts held money back into the wallet when a withdrawal doesn't go ahead. */
  private async returnFunds(tx: Tx, withdrawal: Withdrawal, status: 'FAILED' | 'REJECTED', note: string) {
    const { count } = await tx.withdrawal.updateMany({
      where: { id: withdrawal.id, status: { in: ['REQUESTED', 'APPROVED', 'ON_HOLD'] } },
      data: { status, note },
    });
    if (count === 0) return;
    const pending = await this.ledger.systemWallet(tx, 'PAYOUT_PENDING');
    await this.ledger.post(tx, {
      type: 'WITHDRAWAL',
      description: status === 'REJECTED' ? `Withdrawal rejected: ${note}` : 'Withdrawal failed — money returned',
      idempotencyKey: `withdraw-return:${withdrawal.id}`,
      entries: [
        { walletId: pending.id, amount: -withdrawal.amount },
        { walletId: withdrawal.walletId, amount: withdrawal.amount },
      ],
    });
  }

  // ─── Admin ───

  async approve(id: string, admin: AuthUser) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal || withdrawal.status !== 'REQUESTED') throw new ConflictException('Only requested withdrawals can be approved');
    await this.audit.log({ actorId: admin.id, action: 'withdrawal.approve', entityType: 'withdrawal', entityId: id });
    return this.sendPayout(withdrawal, admin.id);
  }

  async reject(id: string, reason: string, admin: AuthUser) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal || withdrawal.status !== 'REQUESTED') throw new ConflictException('Only requested withdrawals can be rejected');
    await this.prisma.$transaction(async (tx) => {
      await this.returnFunds(tx, withdrawal, 'REJECTED', reason);
      await this.audit.log(
        { actorId: admin.id, action: 'withdrawal.reject', entityType: 'withdrawal', entityId: id, metadata: { reason } },
        tx,
      );
    });
    return this.view(id);
  }

  /** Bank withdrawals: finance pays by bank transfer, then records it here. */
  async markPaid(id: string, reference: string, admin: AuthUser) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal || withdrawal.status !== 'REQUESTED' || withdrawal.method !== 'BANK') {
      throw new ConflictException('Only requested bank withdrawals can be marked as paid');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({ where: { id }, data: { status: 'PAID', providerReceipt: reference, reviewedById: admin.id } });
      const [pending, clearing] = await Promise.all([
        this.ledger.systemWallet(tx, 'PAYOUT_PENDING'),
        this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
      ]);
      await this.ledger.post(tx, {
        type: 'WITHDRAWAL',
        description: `Bank withdrawal paid ${reference}`,
        idempotencyKey: `withdraw-paid:${id}`,
        entries: [
          { walletId: pending.id, amount: -withdrawal.amount },
          { walletId: clearing.id, amount: withdrawal.amount },
        ],
      });
      await this.audit.log(
        { actorId: admin.id, action: 'withdrawal.mark_paid', entityType: 'withdrawal', entityId: id, metadata: { reference } },
        tx,
      );
    });
    return this.view(id);
  }

  private view(id: string) {
    return this.prisma.withdrawal.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        amount: true,
        method: true,
        destination: true,
        status: true,
        providerReceipt: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
