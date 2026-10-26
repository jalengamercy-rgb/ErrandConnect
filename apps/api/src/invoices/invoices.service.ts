import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { INVOICE_DUE_DAYS } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GenerateInvoiceDto, InvoiceListQueryDto } from './invoices.dto.js';

const ORDER_LINE = {
  select: { id: true, orderNumber: true, description: true, total: true, merchantCommission: true, completedAt: true },
} as const;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Invoices of a company or shop the user manages. */
  private async ownerFilter(userId: string): Promise<Prisma.InvoiceWhereInput> {
    const [businesses, merchants] = await Promise.all([
      this.prisma.businessMember.findMany({ where: { userId, role: { in: ['OWNER', 'ADMIN'] } }, select: { businessId: true } }),
      this.prisma.merchantMember.findMany({ where: { userId, role: { in: ['OWNER', 'ADMIN'] } }, select: { merchantId: true } }),
    ]);
    return {
      OR: [{ businessId: { in: businesses.map((b) => b.businessId) } }, { merchantId: { in: merchants.map((m) => m.merchantId) } }],
    };
  }

  async listForUser(userId: string) {
    return this.prisma.invoice.findMany({
      where: await this.ownerFilter(userId),
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { business: { select: { id: true, name: true } }, merchant: { select: { id: true, name: true } } },
    });
  }

  async getForUser(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...(await this.ownerFilter(userId)) },
      include: this.detailInclude(),
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async pay(id: string, userId: string, phone: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, ...(await this.ownerFilter(userId)) } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.payments.requestInvoicePayment(invoice, phone);
  }

  private detailInclude() {
    return {
      business: { select: { id: true, name: true, kraPin: true, billingEmail: true } },
      merchant: { select: { id: true, name: true, taxNumber: true, email: true } },
      orders: { ...ORDER_LINE, orderBy: { completedAt: 'asc' as const } },
      merchantOrders: { ...ORDER_LINE, orderBy: { completedAt: 'asc' as const } },
      payments: { orderBy: { createdAt: 'desc' as const }, select: { status: true, amount: true, providerReceipt: true, createdAt: true } },
    } satisfies Prisma.InvoiceInclude;
  }

  // ─── Admin ───

  async list(query: InvoiceListQueryDto) {
    const where: Prisma.InvoiceWhereInput = { status: query.status, businessId: query.businessId, merchantId: query.merchantId };
    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { business: { select: { id: true, name: true } }, merchant: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async get(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: this.detailInclude() });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /**
   * Collects every completed, not-yet-invoiced order in the period:
   * a company pays the order totals, a shop pays its commission.
   */
  async generate(dto: GenerateInvoiceDto, admin: AuthUser) {
    if (!!dto.businessId === !!dto.merchantId) throw new BadRequestException('Choose either a company or a shop');
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) throw new BadRequestException('The period must end after it starts');

    const invoice = await this.prisma.$transaction(async (tx) => {
      const window = { status: 'COMPLETED' as const, completedAt: { gte: periodStart, lt: periodEnd } };
      const where: Prisma.OrderWhereInput = dto.businessId
        ? { ...window, businessId: dto.businessId, paymentMethod: 'BUSINESS_INVOICE', invoiceId: null }
        : { ...window, merchantId: dto.merchantId, merchantCommission: { gt: 0 }, merchantInvoiceId: null };
      const orders = await tx.order.findMany({ where, select: { id: true, total: true, merchantCommission: true } });
      if (orders.length === 0) throw new BadRequestException('Nothing to invoice in this period');
      const amount = orders.reduce((sum, o) => sum + (dto.businessId ? o.total : o.merchantCommission), 0);

      const created = await tx.invoice.create({
        data: {
          number: await this.nextNumber(tx),
          businessId: dto.businessId,
          merchantId: dto.merchantId,
          periodStart,
          periodEnd,
          amount,
          dueDate: new Date(Date.now() + INVOICE_DUE_DAYS * 86_400_000),
        },
      });
      // The null check stops two invoices claiming the same order.
      const link = dto.businessId ? { invoiceId: created.id } : { merchantInvoiceId: created.id };
      const { count } = await tx.order.updateMany({ where: { ...where, id: { in: orders.map((o) => o.id) } }, data: link });
      if (count !== orders.length) throw new ConflictException('Some orders were invoiced at the same time. Please try again');
      await this.audit.log(
        { actorId: admin.id, action: 'invoice.generate', entityType: 'invoice', entityId: created.id, metadata: { amount, orders: count } },
        tx,
      );
      return created;
    });

    await this.notifyOwner(
      invoice,
      'New invoice',
      `Invoice ${invoice.number} for KES ${invoice.amount.toLocaleString('en-KE')} is due ${invoice.dueDate.toDateString()}.`,
    );
    return this.get(invoice.id);
  }

  /** Bank transfer or other payment received outside the app. */
  async markPaid(id: string, reference: string, admin: AuthUser) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'ISSUED') throw new ConflictException('This invoice is not open');
    await this.prisma.$transaction(async (tx) => {
      await this.payments.creditInvoice(tx, invoice, invoice.amount, reference, `invoice-manual:${invoice.id}`);
      await this.audit.log(
        { actorId: admin.id, action: 'invoice.mark_paid', entityType: 'invoice', entityId: id, metadata: { reference } },
        tx,
      );
    });
    await this.notifyOwner(invoice, 'Invoice paid', `Thank you. We received payment for invoice ${invoice.number}.`);
    return this.get(id);
  }

  /** Cancels an invoice; its orders become billable again. */
  async void(id: string, reason: string, admin: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'VOID' } });
      if (count === 0) throw new ConflictException('Only unpaid invoices can be voided');
      await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.order.updateMany({ where: { merchantInvoiceId: id }, data: { merchantInvoiceId: null } });
      await this.audit.log({ actorId: admin.id, action: 'invoice.void', entityType: 'invoice', entityId: id, metadata: { reason } }, tx);
    });
    return this.get(id);
  }

  /** INV-YYYYMM-0001, numbered per month. */
  private async nextNumber(tx: Prisma.TransactionClient) {
    const now = new Date();
    const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const last = await tx.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private async notifyOwner(invoice: { businessId: string | null; merchantId: string | null }, title: string, body: string) {
    const managers = invoice.businessId
      ? await this.prisma.businessMember.findMany({
          where: { businessId: invoice.businessId, role: { in: ['OWNER', 'ADMIN'] } },
          select: { userId: true },
        })
      : await this.prisma.merchantMember.findMany({
          where: { merchantId: invoice.merchantId!, role: { in: ['OWNER', 'ADMIN'] } },
          select: { userId: true },
        });
    await this.inbox.notify(
      managers.map((m) => m.userId),
      { title, body, link: '/invoices' },
    );
  }
}
