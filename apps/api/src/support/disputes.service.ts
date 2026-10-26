import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES } from '@errandconnect/shared';
import type { AuthUser } from '../common/auth-user.js';
import { AuditService } from '../common/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService } from '../realtime/dispatch.service.js';
import type { DisputeListQueryDto, RaiseDisputeDto, ResolveDisputeDto } from './support.dto.js';

/** Problems can be reported this long after an errand is completed. */
const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Reported problems on an order. Raising a dispute freezes the order
 * (DISPUTED) and its escrow (ON_HOLD) until support resolves it.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly dispatch: DispatchService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  async raise(orderId: string, userId: string, dto: RaiseDisputeDto) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, OR: [{ customerId: userId }, { runnerId: userId }] } });
    if (!order) throw new NotFoundException('Order not found');
    const recentlyCompleted =
      order.status === 'COMPLETED' && order.completedAt && Date.now() - order.completedAt.getTime() < DISPUTE_WINDOW_MS;
    const disputable =
      (ACTIVE_ORDER_STATUSES.includes(order.status) && order.status !== 'AWAITING_PAYMENT' && order.runnerId) || recentlyCompleted;
    if (!disputable)
      throw new ConflictException('Problems can be reported while an errand is in progress, or up to 7 days after it is completed');

    const dispute = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: 'DISPUTED' } });
      if (count === 0) throw new ConflictException('The order changed. Please refresh');
      await tx.escrow.updateMany({ where: { orderId, status: 'HELD' }, data: { status: 'ON_HOLD' } });
      await tx.orderEvent.create({
        data: { orderId, status: 'DISPUTED', actorId: userId, note: 'Problem reported — support is reviewing' },
      });
      return tx.dispute.create({
        data: { orderId, raisedById: userId, type: dto.type, description: dto.description, previousOrderStatus: order.status },
      });
    });

    this.dispatch.orderUpdated(orderId, order.customerId, order.runnerId, 'DISPUTED');
    const other = userId === order.customerId ? order.runnerId : order.customerId;
    if (other) {
      await this.inbox.notify([other], {
        title: `Problem reported on ${order.orderNumber}`,
        body: 'Our support team is reviewing it and will contact you if needed.',
        link: `/orders/${orderId}`,
      });
    }
    return dispute;
  }

  async list(query: DisputeListQueryDto) {
    const where: Prisma.DisputeWhereInput = { status: query.status };
    const [total, items] = await Promise.all([
      this.prisma.dispute.count({ where }),
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          order: { select: { id: true, orderNumber: true, total: true, paymentMethod: true } },
          raisedBy: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async get(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        raisedBy: { select: { id: true, firstName: true, lastName: true, phone: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        order: {
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
            runner: { select: { id: true, firstName: true, lastName: true, phone: true } },
            escrow: true,
            events: { orderBy: { createdAt: 'asc' } },
            messages: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, senderId: true, createdAt: true } },
          },
        },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const { deliveryPin: _pin, pricingSnapshot: _snapshot, ...order } = dispute.order;
    return { ...dispute, order };
  }

  async resolve(id: string, dto: ResolveDisputeDto, admin: AuthUser) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id }, include: { order: { include: { escrow: true } } } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status !== 'OPEN') throw new ConflictException('This dispute is already resolved');
    const order = dispute.order;
    const escrowOnHold = order.escrow?.status === 'ON_HOLD';
    if (dto.outcome === 'REFUND_CUSTOMER' && !escrowOnHold && !dto.refundAmount) {
      throw new BadRequestException('This errand has no money on hold. Enter a refundAmount to credit the customer');
    }
    if (dto.refundAmount && dto.refundAmount > order.total) throw new BadRequestException('Refund cannot be more than the order total');

    let finalStatus = dispute.previousOrderStatus;
    await this.prisma.$transaction(async (tx) => {
      if (dto.outcome === 'REFUND_CUSTOMER' && escrowOnHold) {
        await this.payments.refundEscrow(tx, order, { includeOnHold: true });
        finalStatus = 'CANCELLED';
      } else if (dto.outcome === 'REFUND_CUSTOMER') {
        await this.payments.creditFromPlatform(tx, order, dto.refundAmount!, `Dispute credit for ${order.orderNumber}`);
      } else if (dto.outcome === 'PAY_RUNNER' && escrowOnHold) {
        if (!order.runnerId) throw new BadRequestException('No runner to pay on this order');
        await this.payments.releaseEscrow(tx, order, order.runnerId, { includeOnHold: true });
        finalStatus = 'COMPLETED';
      } else if (escrowOnHold) {
        await tx.escrow.update({ where: { orderId: order.id }, data: { status: 'HELD' } });
      }

      const now = new Date();
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          ...(finalStatus === 'CANCELLED' ? { cancelledAt: now, cancelReason: `Dispute resolved: ${dto.resolution}` } : {}),
          ...(finalStatus === 'COMPLETED' && !order.completedAt ? { completedAt: now, deliveredAt: now } : {}),
        },
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, status: finalStatus, actorId: admin.id, note: `Dispute resolved: ${dto.resolution}` },
      });
      await tx.dispute.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          outcome: dto.outcome,
          refundAmount: dto.refundAmount,
          resolution: dto.resolution,
          resolvedById: admin.id,
          resolvedAt: now,
        },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'dispute.resolve',
          entityType: 'dispute',
          entityId: id,
          metadata: { outcome: dto.outcome, refundAmount: dto.refundAmount ?? null },
        },
        tx,
      );
    });

    this.dispatch.orderUpdated(order.id, order.customerId, order.runnerId, finalStatus);
    await this.inbox.notify([order.customerId, ...(order.runnerId ? [order.runnerId] : [])], {
      title: `Problem on ${order.orderNumber} resolved`,
      body: dto.resolution,
      link: `/orders/${order.id}`,
    });
    return this.get(id);
  }
}
