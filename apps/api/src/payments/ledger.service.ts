import { BadRequestException, Injectable } from '@nestjs/common';
import type { LedgerTransactionType, Prisma, WalletType } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export interface LedgerEntryInput {
  walletId: string;
  /** Positive = money into the wallet, negative = money out. */
  amount: number;
  /** Refuse the whole transaction if this would take the wallet below zero. */
  noOverdraft?: boolean;
  /** Refuse if this would take the wallet below this balance (e.g. minus a company's credit limit). */
  minBalance?: number;
}

export interface PostInput {
  type: LedgerTransactionType;
  description: string;
  orderId?: string;
  /** The same key is only ever booked once (e.g. a repeated M-Pesa callback). */
  idempotencyKey?: string;
  entries: LedgerEntryInput[];
}

export class InsufficientFundsException extends BadRequestException {
  constructor() {
    super('Not enough balance in your wallet');
  }
}

/**
 * Double-entry bookkeeping: every movement of money is a transaction whose
 * entries add up to zero, so money is never created or lost. Wallet balances
 * are kept in step in the same database transaction.
 *
 * Always call inside prisma.$transaction so the booking and the business
 * change it belongs to succeed or fail together.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, input: PostInput) {
    if (input.entries.length < 2) throw new Error('A ledger transaction needs at least two entries');
    if (input.entries.some((e) => !Number.isInteger(e.amount))) throw new Error('Ledger amounts must be whole shillings');
    const sum = input.entries.reduce((total, e) => total + e.amount, 0);
    if (sum !== 0) throw new Error(`Ledger entries must add up to zero (got ${sum})`);

    if (input.idempotencyKey) {
      const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: input.type,
        description: input.description,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        entries: { create: input.entries.filter((e) => e.amount !== 0).map(({ walletId, amount }) => ({ walletId, amount })) },
      },
    });

    for (const entry of input.entries) {
      if (entry.amount === 0) continue;
      const floor = entry.minBalance ?? (entry.noOverdraft ? 0 : undefined);
      if (floor !== undefined && entry.amount < 0) {
        // Conditional update: only succeeds if the balance covers it, even with concurrent requests.
        const { count } = await tx.wallet.updateMany({
          where: { id: entry.walletId, balance: { gte: floor - entry.amount } },
          data: { balance: { increment: entry.amount } },
        });
        if (count === 0) throw new InsufficientFundsException();
      } else {
        await tx.wallet.update({ where: { id: entry.walletId }, data: { balance: { increment: entry.amount } } });
      }
    }
    return transaction;
  }

  /** A user's wallet of the given type, created on first use. */
  async userWallet(tx: Tx, userId: string, type: Extract<WalletType, 'CUSTOMER' | 'RUNNER'>) {
    return tx.wallet.upsert({ where: { type_userId: { type, userId } }, update: {}, create: { type, userId } });
  }

  /** A company's or shop's wallet, created on first use. */
  async orgWallet(tx: Tx, type: 'BUSINESS' | 'MERCHANT', ownerId: string) {
    return type === 'BUSINESS'
      ? tx.wallet.upsert({ where: { type_businessId: { type, businessId: ownerId } }, update: {}, create: { type, businessId: ownerId } })
      : tx.wallet.upsert({ where: { type_merchantId: { type, merchantId: ownerId } }, update: {}, create: { type, merchantId: ownerId } });
  }

  /** One of the platform's own wallets (escrow, revenue...). */
  async systemWallet(tx: Tx, type: Extract<WalletType, 'ESCROW' | 'PLATFORM_REVENUE' | 'EXTERNAL_CLEARING' | 'PAYOUT_PENDING'>) {
    const existing = await tx.wallet.findFirst({ where: { type, userId: null, businessId: null, merchantId: null } });
    return existing ?? tx.wallet.create({ data: { type } });
  }
}
