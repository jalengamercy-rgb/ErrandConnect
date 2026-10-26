import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../payments/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BannerDto } from './growth.dto.js';

/** Home-screen promotions, including paid ads. */
@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Live banners for this person, highest priority first. */
  forUser(user: AuthUser) {
    const audiences: ('ALL' | 'CUSTOMERS' | 'RUNNERS')[] = ['ALL'];
    if (user.isCustomer) audiences.push('CUSTOMERS');
    if (user.isRunner) audiences.push('RUNNERS');
    const now = new Date();
    return this.prisma.banner.findMany({
      where: { isActive: true, audience: { in: audiences }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: { id: true, title: true, body: true, merchantId: true, categorySlug: true, url: true },
    });
  }

  async track(id: string, event: 'impression' | 'click') {
    await this.prisma.banner.updateMany({
      where: { id },
      data: event === 'click' ? { clicks: { increment: 1 } } : { impressions: { increment: 1 } },
    });
    return { ok: true };
  }

  // ─── Admin ───

  list() {
    return this.prisma.banner.findMany({ orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }], take: 200 });
  }

  private async check(dto: Partial<BannerDto>) {
    const targets = [dto.merchantId, dto.categorySlug, dto.url].filter(Boolean).length;
    if (targets > 1) throw new BadRequestException('Link a banner to one shop, errand type or web page, not several');
    if (dto.merchantId && !(await this.prisma.merchant.findFirst({ where: { id: dto.merchantId, status: 'ACTIVE' } })))
      throw new BadRequestException('Shop not found or not active');
    if (dto.categorySlug && !(await this.prisma.serviceCategory.findUnique({ where: { slug: dto.categorySlug } })))
      throw new BadRequestException('Unknown errand type');
  }

  private data(dto: Partial<BannerDto>) {
    return {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null,
    };
  }

  async create(dto: BannerDto, admin: AuthUser) {
    await this.check(dto);
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.banner.create({ data: { ...this.data(dto), title: dto.title, createdById: admin.id } });
      await this.audit.log(
        { actorId: admin.id, action: 'banner.create', entityType: 'banner', entityId: banner.id, metadata: { title: dto.title } },
        tx,
      );
      return banner;
    });
  }

  async update(id: string, dto: Partial<BannerDto>, admin: AuthUser) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner not found');
    // Check the link the banner will have after the change.
    await this.check({
      merchantId: dto.merchantId === undefined ? existing.merchantId : dto.merchantId,
      categorySlug: dto.categorySlug === undefined ? existing.categorySlug : dto.categorySlug,
      url: dto.url === undefined ? existing.url : dto.url,
    });
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.banner.update({ where: { id }, data: this.data(dto) });
      await this.audit.log(
        { actorId: admin.id, action: 'banner.update', entityType: 'banner', entityId: id, metadata: { ...dto } as Prisma.InputJsonValue },
        tx,
      );
      return banner;
    });
  }

  /** An advertiser paid for this banner (bank or M-Pesa, outside the app). */
  async recordPayment(id: string, amount: number, reference: string, admin: AuthUser) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return this.prisma.$transaction(async (tx) => {
      const [clearing, platform] = await Promise.all([
        this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
        this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
      ]);
      await this.ledger.post(tx, {
        type: 'ADVERTISING',
        description: `Ad payment ${reference}${banner.advertiser ? ` from ${banner.advertiser}` : ''}`,
        idempotencyKey: `ad:${id}:${reference}`,
        entries: [
          { walletId: clearing.id, amount: -amount },
          { walletId: platform.id, amount },
        ],
      });
      const updated = await tx.banner.update({ where: { id }, data: { amountPaid: { increment: amount } } });
      await this.audit.log(
        { actorId: admin.id, action: 'banner.payment', entityType: 'banner', entityId: id, metadata: { amount, reference } },
        tx,
      );
      return updated;
    });
  }
}
