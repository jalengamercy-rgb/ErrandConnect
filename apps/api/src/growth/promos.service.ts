import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { promoDiscountFor } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { Prisma, PromoCode } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePromoDto, PromoListQueryDto, UpdatePromoDto } from './growth.dto.js';

/** Redemptions on these orders don't use up the code. */
const VOID_STATUSES = ['CANCELLED', 'REFUNDED'] as const;

export class PromoError extends BadRequestException {}

@Injectable()
export class PromosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks a code for this customer and order, and works out the discount.
   * `gross` is the order total before discount; `fees` is the part that can be discounted.
   */
  async evaluate(userId: string, rawCode: string, gross: number, fees: number): Promise<{ promo: PromoCode; discount: number }> {
    const code = rawCode.trim().toUpperCase();
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    const now = new Date();
    if (!promo || !promo.isActive || (promo.startsAt && promo.startsAt > now)) throw new PromoError('This promo code is not valid');
    if (promo.endsAt && promo.endsAt <= now) throw new PromoError('This promo code has expired');
    if (gross < promo.minOrderValue) {
      throw new PromoError(`This code needs an order of at least KES ${promo.minOrderValue.toLocaleString('en-KE')}`);
    }
    const counted = { order: { status: { notIn: [...VOID_STATUSES] } } };
    const [used, usedByMe, previousOrders] = await Promise.all([
      promo.maxRedemptions ? this.prisma.promoRedemption.count({ where: { promoId: promo.id, ...counted } }) : 0,
      this.prisma.promoRedemption.count({ where: { promoId: promo.id, userId, ...counted } }),
      promo.firstOrderOnly
        ? this.prisma.order.count({ where: { customerId: userId, status: { notIn: [...VOID_STATUSES, 'AWAITING_PAYMENT'] } } })
        : 0,
    ]);
    if (promo.maxRedemptions && used >= promo.maxRedemptions) throw new PromoError('This promo code has been fully used');
    if (usedByMe >= promo.perUserLimit) throw new PromoError('You have already used this promo code');
    if (previousOrders > 0) throw new PromoError('This code is only for your first errand');
    const discount = promoDiscountFor({ type: promo.type, value: promo.value, maxDiscount: promo.maxDiscount }, fees);
    if (discount <= 0) throw new PromoError('This code gives no discount on this errand');
    return { promo, discount };
  }

  // ─── Admin ───

  async list(query: PromoListQueryDto) {
    const where: Prisma.PromoCodeWhereInput = {
      ...(query.state ? { isActive: query.state === 'active' } : {}),
      ...(query.search
        ? { OR: [{ code: { contains: query.search.toUpperCase() } }, { description: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, promos] = await Promise.all([
      this.prisma.promoCode.count({ where }),
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const stats = await this.prisma.promoRedemption.groupBy({
      by: ['promoId'],
      where: { promoId: { in: promos.map((p) => p.id) }, order: { status: { notIn: [...VOID_STATUSES] } } },
      _count: true,
      _sum: { amount: true },
    });
    const byId = new Map(stats.map((s) => [s.promoId, s]));
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: promos.map((p) => ({ ...p, redemptions: byId.get(p.id)?._count ?? 0, discountGiven: byId.get(p.id)?._sum.amount ?? 0 })),
    };
  }

  async create(dto: CreatePromoDto, actorId: string) {
    if (dto.type === 'FIXED' && dto.maxDiscount) throw new BadRequestException('maxDiscount is only for percent codes');
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt))
      throw new BadRequestException('The end must be after the start');
    const exists = await this.prisma.promoCode.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('A promo with this code already exists');
    return this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.create({
        data: {
          ...dto,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          createdById: actorId,
        },
      });
      await this.audit.log(
        { actorId, action: 'promo.create', entityType: 'promo', entityId: promo.id, metadata: { code: promo.code } },
        tx,
      );
      return promo;
    });
  }

  async update(id: string, dto: UpdatePromoDto, actorId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promo not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.promoCode.update({
        where: { id },
        data: { ...dto, endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null },
      });
      await this.audit.log({ actorId, action: 'promo.update', entityType: 'promo', entityId: id, metadata: { ...dto } }, tx);
      return updated;
    });
  }
}
