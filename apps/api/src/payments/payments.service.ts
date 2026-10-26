import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Invoice, Order, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService } from '../realtime/dispatch.service.js';
import { InsufficientFundsException, LedgerService } from './ledger.service.js';
import { FakeMpesaClient } from './mpesa/fake.client.js';
import { MpesaClient, MpesaError, parseStkCallback, type StkCallbackResult } from './mpesa/mpesa.client.js';
import { WithdrawalsService } from './withdrawals.service.js';

type Tx = Prisma.TransactionClient;

/** Wait this long before sending another payment prompt for the same order. */
const STK_RESEND_COOLDOWN_MS = 30_000;

/**
 * Customer payments and escrow.
 *
 * Money flow for an M-Pesa or wallet order:
 *   pay      customer → ESCROW            (order becomes visible to runners)
 *   deliver  ESCROW → runner + platform   (delivery PIN confirmed)
 *   cancel   ESCROW → customer wallet     (full refund)
 * Cash orders skip escrow; on delivery the runner owes the platform its fee.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly mpesa: MpesaClient,
    private readonly dispatch: DispatchService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  onModuleInit() {
    // Simulated M-Pesa delivers its callbacks straight to the handlers.
    if (this.mpesa instanceof FakeMpesaClient) {
      this.mpesa.onCallback((kind, body) => (kind === 'stk' ? this.handleStkCallback(body) : this.withdrawals.handleB2cResult(body)));
    }
  }

  // ─── M-Pesa STK Push ───

  /** Sends the "enter your M-Pesa PIN" prompt to the customer's phone. */
  async requestMpesaPayment(order: Order, phone: string) {
    if (order.status !== 'AWAITING_PAYMENT') throw new ConflictException('This errand is already paid for');
    const recent = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: 'PENDING', createdAt: { gt: new Date(Date.now() - STK_RESEND_COOLDOWN_MS) } },
    });
    if (recent)
      throw new HttpException('A payment request was just sent. Check your phone or try again in 30 seconds', HttpStatus.TOO_MANY_REQUESTS);

    try {
      const response = await this.mpesa.stkPush({
        phone,
        amount: order.total,
        accountReference: order.orderNumber.replace(/-/g, '').slice(-12),
        description: 'ErrandCONNECT',
      });
      await this.prisma.$transaction([
        this.prisma.payment.create({
          data: { orderId: order.id, provider: 'MPESA', amount: order.total, phone, providerRequestId: response.checkoutRequestId },
        }),
        this.prisma.order.update({ where: { id: order.id }, data: { mpesaPhone: phone } }),
      ]);
      return { requested: true, message: 'Check your phone and enter your M-Pesa PIN to pay' };
    } catch (error) {
      if (error instanceof MpesaError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Safaricom's answer to an STK push. Safe to receive more than once. */
  async handleStkCallback(body: unknown) {
    const result = parseStkCallback(body);
    if (!result) {
      this.logger.warn('Ignoring unreadable STK callback');
      return;
    }
    await this.settleStk(result, body);
  }

  private async settleStk(result: StkCallbackResult, raw: unknown) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRequestId: result.checkoutRequestId },
      include: { order: true, invoice: true },
    });
    if (!payment || payment.status !== 'PENDING') return;
    if (payment.invoice) return this.settleInvoiceStk(payment.id, payment.invoice, result, raw);
    const order = payment.order;

    if (result.resultCode !== 0) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: result.resultCode === 1032 ? 'CANCELLED' : 'FAILED',
          failureReason: result.resultDesc,
          rawCallback: raw as Prisma.InputJsonValue,
        },
      });
      if (order) this.dispatch.orderUpdated(order.id, order.customerId, null, order.status);
      return;
    }

    const amount = result.amount ?? payment.amount;
    let paidOrder: Order | null = null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'SUCCEEDED', providerReceipt: result.receipt, rawCallback: raw as Prisma.InputJsonValue },
      });
      if (count === 0) return; // another callback got here first
      const [clearing, escrow] = await Promise.all([
        this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
        this.ledger.systemWallet(tx, 'ESCROW'),
      ]);
      await this.ledger.post(tx, {
        type: 'PAYMENT_IN',
        description: `M-Pesa payment ${result.receipt ?? ''}`.trim(),
        orderId: order?.id,
        idempotencyKey: `stk:${result.checkoutRequestId}`,
        entries: [
          { walletId: clearing.id, amount: -amount },
          { walletId: escrow.id, amount },
        ],
      });

      if (order && order.status === 'AWAITING_PAYMENT' && amount >= order.total) {
        await tx.escrow.create({ data: { orderId: order.id, amount: order.total } });
        // Anything paid above the total goes to the customer's wallet.
        if (amount > order.total)
          await this.toCustomerWallet(
            tx,
            order,
            amount - order.total,
            `Overpayment on ${order.orderNumber}`,
            `overpay:${result.checkoutRequestId}`,
          );
        paidOrder = await tx.order.update({ where: { id: order.id }, data: { status: 'PENDING', paidAt: new Date() } });
        await tx.orderEvent.create({
          data: { orderId: order.id, status: 'PENDING', note: `Paid via M-Pesa ${result.receipt ?? ''}`.trim() },
        });
      } else if (order) {
        // Paid too little, or the errand was cancelled while paying: keep the money safe in their wallet.
        await this.toCustomerWallet(
          tx,
          order,
          amount,
          `M-Pesa payment for ${order.orderNumber} credited to wallet`,
          `credit:${result.checkoutRequestId}`,
        );
      }
    });

    if (order) this.dispatch.orderUpdated(order.id, order.customerId, null, paidOrder ? 'PENDING' : order.status);
    if (paidOrder) await this.dispatch.newJob(paidOrder);
  }

  /** Returns escrowed money to whoever paid: the company for invoice orders, otherwise the customer's wallet. */
  private async toCustomerWallet(tx: Tx, order: Order, amount: number, description: string, idempotencyKey: string) {
    const [escrow, wallet] = await Promise.all([
      this.ledger.systemWallet(tx, 'ESCROW'),
      order.paymentMethod === 'BUSINESS_INVOICE' && order.businessId
        ? this.ledger.orgWallet(tx, 'BUSINESS', order.businessId)
        : this.ledger.userWallet(tx, order.customerId, 'CUSTOMER'),
    ]);
    await this.ledger.post(tx, {
      type: 'REFUND',
      description,
      orderId: order.id,
      idempotencyKey,
      entries: [
        { walletId: escrow.id, amount: -amount },
        { walletId: wallet.id, amount },
      ],
    });
  }

  /** Asks M-Pesa directly about a payment whose callback hasn't arrived. */
  async refresh(orderId: string, customerId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: 'PENDING', order: { customerId } },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment?.providerRequestId) return { status: 'NO_PENDING_PAYMENT' };
    const query = await this.mpesa.stkQuery(payment.providerRequestId);
    if (query.resultCode !== null) {
      await this.settleStk(
        { checkoutRequestId: payment.providerRequestId, resultCode: query.resultCode, resultDesc: query.resultDesc },
        { query },
      );
    }
    const latest = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { status: latest.status, reason: latest.failureReason };
  }

  /** Latest payment attempt, for showing "waiting / failed" in the app. */
  latestPayment(orderId: string) {
    return this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, failureReason: true, providerReceipt: true, phone: true, amount: true, createdAt: true },
    });
  }

  // ─── Escrow steps used by the orders code (inside its transactions) ───

  /** Pays for a new order from the customer's wallet balance. */
  async holdFromWallet(tx: Tx, order: Order) {
    const [wallet, escrow] = await Promise.all([
      this.ledger.userWallet(tx, order.customerId, 'CUSTOMER'),
      this.ledger.systemWallet(tx, 'ESCROW'),
    ]);
    await this.ledger.post(tx, {
      type: 'ESCROW_HOLD',
      description: `Payment for ${order.orderNumber}`,
      orderId: order.id,
      idempotencyKey: `wallet-pay:${order.id}`,
      entries: [
        { walletId: wallet.id, amount: -order.total, noOverdraft: true },
        { walletId: escrow.id, amount: order.total },
      ],
    });
    await tx.escrow.create({ data: { orderId: order.id, amount: order.total } });
  }

  /**
   * Charges a business order to the company's credit. The company wallet goes
   * negative (what they owe) but never below minus their credit limit.
   */
  async holdFromBusinessCredit(tx: Tx, order: Order, creditLimit: number) {
    if (!order.businessId) throw new Error('Not a business order');
    const [wallet, escrow] = await Promise.all([
      this.ledger.orgWallet(tx, 'BUSINESS', order.businessId),
      this.ledger.systemWallet(tx, 'ESCROW'),
    ]);
    try {
      await this.ledger.post(tx, {
        type: 'ESCROW_HOLD',
        description: `Errand ${order.orderNumber} on company account`,
        orderId: order.id,
        idempotencyKey: `credit-hold:${order.id}`,
        entries: [
          { walletId: wallet.id, amount: -order.total, minBalance: -creditLimit },
          { walletId: escrow.id, amount: order.total },
        ],
      });
    } catch (error) {
      if (error instanceof InsufficientFundsException) {
        throw new BadRequestException('Your company has reached its credit limit. Please pay the outstanding invoice or contact us');
      }
      throw error;
    }
    await tx.escrow.create({ data: { orderId: order.id, amount: order.total } });
  }

  /** Shop orders: the merchant owes the platform its commission (billed monthly). */
  async chargeMerchantCommission(tx: Tx, order: Order) {
    if (!order.merchantId || order.merchantCommission <= 0) return;
    const [merchant, platform] = await Promise.all([
      this.ledger.orgWallet(tx, 'MERCHANT', order.merchantId),
      this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
    ]);
    await this.ledger.post(tx, {
      type: 'ADJUSTMENT',
      description: `Commission on ${order.orderNumber}`,
      orderId: order.id,
      idempotencyKey: `merchant-fee:${order.id}`,
      entries: [
        { walletId: merchant.id, amount: -order.merchantCommission },
        { walletId: platform.id, amount: order.merchantCommission },
      ],
    });
  }

  // ─── Invoices ───

  /** Money received for a business or merchant invoice (M-Pesa or bank). */
  async creditInvoice(tx: Tx, invoice: Invoice, amount: number, reference: string, idempotencyKey: string) {
    const ownerType = invoice.businessId ? 'BUSINESS' : 'MERCHANT';
    const [clearing, wallet] = await Promise.all([
      this.ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
      this.ledger.orgWallet(tx, ownerType, (invoice.businessId ?? invoice.merchantId)!),
    ]);
    await this.ledger.post(tx, {
      type: 'PAYMENT_IN',
      description: `Payment for invoice ${invoice.number} ${reference}`.trim(),
      idempotencyKey,
      entries: [
        { walletId: clearing.id, amount: -amount },
        { walletId: wallet.id, amount },
      ],
    });
    if (amount >= invoice.amount) {
      await tx.invoice.updateMany({
        where: { id: invoice.id, status: 'ISSUED' },
        data: { status: 'PAID', paidAt: new Date(), paymentReference: reference },
      });
    }
  }

  private async settleInvoiceStk(paymentId: string, invoice: Invoice, result: StkCallbackResult, raw: unknown) {
    if (result.resultCode !== 0) {
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: {
          status: result.resultCode === 1032 ? 'CANCELLED' : 'FAILED',
          failureReason: result.resultDesc,
          rawCallback: raw as Prisma.InputJsonValue,
        },
      });
      return;
    }
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'SUCCEEDED', providerReceipt: result.receipt, rawCallback: raw as Prisma.InputJsonValue },
      });
      if (count === 0) return;
      await this.creditInvoice(tx, invoice, result.amount ?? payment.amount, result.receipt ?? '', `stk:${result.checkoutRequestId}`);
    });
  }

  /** Sends an M-Pesa prompt to pay an invoice. */
  async requestInvoicePayment(invoice: Invoice, phone: string) {
    if (invoice.status !== 'ISSUED') throw new ConflictException('This invoice is not open for payment');
    try {
      const response = await this.mpesa.stkPush({
        phone,
        amount: invoice.amount,
        accountReference: invoice.number.replace(/-/g, '').slice(-12),
        description: 'ErrandCONNECT',
      });
      await this.prisma.payment.create({
        data: { invoiceId: invoice.id, provider: 'MPESA', amount: invoice.amount, phone, providerRequestId: response.checkoutRequestId },
      });
      return { requested: true, message: 'Check your phone and enter your M-Pesa PIN to pay' };
    } catch (error) {
      if (error instanceof MpesaError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Delivery confirmed: pay the runner and the platform from escrow. */
  async releaseEscrow(tx: Tx, order: Order, runnerId: string, { includeOnHold = false } = {}) {
    const held = await tx.escrow.updateMany({
      where: { orderId: order.id, status: { in: includeOnHold ? ['HELD', 'ON_HOLD'] : ['HELD'] } },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    if (held.count === 0) throw new ConflictException('Payment for this errand is on hold. Please contact support');
    const [escrow, runner, platform] = await Promise.all([
      this.ledger.systemWallet(tx, 'ESCROW'),
      this.ledger.userWallet(tx, runnerId, 'RUNNER'),
      this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
    ]);
    await this.ledger.post(tx, {
      type: 'ESCROW_RELEASE',
      description: `Errand ${order.orderNumber} completed`,
      orderId: order.id,
      idempotencyKey: `release:${order.id}`,
      entries: [
        { walletId: escrow.id, amount: -order.total },
        { walletId: runner.id, amount: order.runnerEarnings },
        { walletId: platform.id, amount: order.platformFee },
      ],
    });
  }

  /** Cash errand completed: the runner collected everything, so they owe the platform its fee. */
  async chargeCashCommission(tx: Tx, order: Order, runnerId: string) {
    const [runner, platform] = await Promise.all([
      this.ledger.userWallet(tx, runnerId, 'RUNNER'),
      this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
    ]);
    await this.ledger.post(tx, {
      type: 'ADJUSTMENT',
      description: `Platform fee for cash errand ${order.orderNumber}`,
      orderId: order.id,
      idempotencyKey: `cash-fee:${order.id}`,
      entries: [
        { walletId: runner.id, amount: -order.platformFee },
        { walletId: platform.id, amount: order.platformFee },
      ],
    });
  }

  /** Cancelled after paying: everything goes back to the customer's wallet. */
  async refundEscrow(tx: Tx, order: Order, { includeOnHold = false } = {}) {
    const held = await tx.escrow.updateMany({
      where: { orderId: order.id, status: { in: includeOnHold ? ['HELD', 'ON_HOLD'] : ['HELD'] } },
      data: { status: 'REFUNDED', releasedAt: new Date() },
    });
    if (held.count === 0) return false;
    await this.toCustomerWallet(tx, order, order.total, `Refund for cancelled errand ${order.orderNumber}`, `refund:${order.id}`);
    return true;
  }

  /** Goodwill credit from platform revenue, e.g. after a dispute on an errand already paid out. */
  async creditFromPlatform(tx: Tx, order: Order, amount: number, reason: string) {
    const [platform, wallet] = await Promise.all([
      this.ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
      this.ledger.userWallet(tx, order.customerId, 'CUSTOMER'),
    ]);
    await this.ledger.post(tx, {
      type: 'ADJUSTMENT',
      description: reason,
      orderId: order.id,
      entries: [
        { walletId: platform.id, amount: -amount },
        { walletId: wallet.id, amount },
      ],
    });
  }

  async ensureOrderOwner(orderId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
