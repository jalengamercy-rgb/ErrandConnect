import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { INVOICE_DUE_DAYS } from '@errandconnect/shared';
import { nextInvoiceNumber } from '../invoices/invoices.service.js';
import { LedgerService } from '../payments/ledger.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GrowthSettingsService } from './growth-settings.service.js';

const WEEK_MS = 7 * 86_400_000;

/**
 * Shops pay to be featured at the top of the directory. Buying issues an
 * invoice (charged to the shop straight away); the placement starts once it's paid.
 */
@Injectable()
export class FeaturedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly settings: GrowthSettingsService,
  ) {}

  async offer(merchantId: string, userId: string) {
    const merchant = await this.manageableShop(merchantId, userId);
    const config = await this.settings.get();
    const openInvoice = await this.prisma.invoice.findFirst({ where: { merchantId, kind: 'FEATURED_LISTING', status: 'ISSUED' } });
    return { weeklyPrice: config.featured.weeklyPrice, featuredUntil: merchant.featuredUntil, openInvoice };
  }

  async buy(merchantId: string, userId: string, weeks: number, phone?: string) {
    const merchant = await this.manageableShop(merchantId, userId);
    if (merchant.status !== 'ACTIVE') throw new ForbiddenException('Your shop must be approved first');
    const price = (await this.settings.get()).featured.weeklyPrice * weeks;
    const invoice = await this.prisma.$transaction(async (tx) => {
      // One unpaid featured invoice at a time: pay that one first.
      const open = await tx.invoice.findFirst({ where: { merchantId, kind: 'FEATURED_LISTING', status: 'ISSUED' } });
      if (open) return open;
      const start = new Date(Math.max(Date.now(), merchant.featuredUntil?.getTime() ?? 0));
      const created = await tx.invoice.create({
        data: {
          number: await nextInvoiceNumber(tx),
          kind: 'FEATURED_LISTING',
          featuredWeeks: weeks,
          merchantId,
          periodStart: start,
          periodEnd: new Date(start.getTime() + weeks * WEEK_MS),
          amount: price,
          dueDate: new Date(Date.now() + INVOICE_DUE_DAYS * 86_400_000),
        },
      });
      const [shop, platform] = await Promise.all([
        this.ledger.orgWallet(tx, 'MERCHANT', merchantId),
        this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
      ]);
      await this.ledger.post(tx, {
        type: 'FEATURED_LISTING',
        description: `Featured listing ${created.number} (${weeks} week${weeks === 1 ? '' : 's'})`,
        idempotencyKey: `featured:${created.id}`,
        entries: [
          { walletId: shop.id, amount: -price },
          { walletId: platform.id, amount: price },
        ],
      });
      return created;
    });
    const payment = phone ? await this.payments.requestInvoicePayment(invoice, phone) : null;
    return { invoice, payment };
  }

  private async manageableShop(merchantId: string, userId: string) {
    const member = await this.prisma.merchantMember.findUnique({
      where: { merchantId_userId: { merchantId, userId } },
      include: { merchant: true },
    });
    if (!member) throw new NotFoundException('Shop not found');
    if (member.role === 'MEMBER') throw new ForbiddenException('Only shop owners and admins can buy featured placement');
    return member.merchant;
  }
}
