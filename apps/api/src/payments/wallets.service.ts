import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's customer and runner wallets, with money currently being withdrawn. */
  async list(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, type: { in: ['CUSTOMER', 'RUNNER'] } },
      select: { id: true, type: true, balance: true, currency: true },
      orderBy: { type: 'asc' },
    });
    const pending = await this.prisma.withdrawal.groupBy({
      by: ['walletId'],
      where: { walletId: { in: wallets.map((w) => w.id) }, status: { in: ['REQUESTED', 'APPROVED', 'ON_HOLD'] } },
      _sum: { amount: true },
    });
    return wallets.map(({ id, ...w }) => ({ ...w, pendingWithdrawals: pending.find((p) => p.walletId === id)?._sum.amount ?? 0 }));
  }

  async transactions(userId: string, type: 'CUSTOMER' | 'RUNNER', page = 1, pageSize = 30) {
    const wallet = await this.prisma.wallet.findUnique({ where: { type_userId: { type, userId } } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        transaction: { select: { type: true, description: true, order: { select: { id: true, orderNumber: true } } } },
      },
    });
    return entries.map((e) => ({
      id: e.id,
      amount: e.amount,
      createdAt: e.createdAt,
      type: e.transaction.type,
      description: e.transaction.description,
      order: e.transaction.order,
    }));
  }

  withdrawals(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { wallet: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, amount: true, method: true, destination: true, status: true, providerReceipt: true, note: true, createdAt: true },
    });
  }
}
