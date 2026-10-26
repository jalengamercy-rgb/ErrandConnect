import { Body, Controller, Get, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles, Staff, type AuthUser } from '../common/auth-user.js';
import { safeEqualHex, sha256 } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReasonDto } from '../admin/admin.dto.js';
import { parseB2cCallback } from './mpesa/mpesa.client.js';
import {
  EscrowListQueryDto,
  PayDto,
  PaymentListQueryDto,
  ReferenceDto,
  TransactionsQueryDto,
  WalletTypeParam,
  WithdrawalListQueryDto,
  WithdrawDto,
} from './payments.dto.js';
import { PaymentsService } from './payments.service.js';
import { WalletsService } from './wallets.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

/** What Safaricom expects back from a callback, so it stops retrying. */
const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

/**
 * Endpoints Safaricom calls. They're public, so each URL carries a secret
 * (MPESA_CALLBACK_SECRET). In production also restrict them to Safaricom's
 * IP addresses at the load balancer.
 */
@Public()
@Controller('payments/mpesa')
export class MpesaCallbackController {
  private readonly logger = new Logger(MpesaCallbackController.name);
  private readonly secretHash: string;

  constructor(
    config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly prisma: PrismaService,
  ) {
    this.secretHash = sha256(config.getOrThrow<string>('MPESA_CALLBACK_SECRET'));
  }

  private check(secret: string) {
    // Compare hashes so the check takes the same time whatever is sent.
    if (!safeEqualHex(sha256(secret), this.secretHash)) throw new NotFoundException();
  }

  @Post('stk-callback/:secret')
  @HttpCode(200)
  async stk(@Param('secret') secret: string, @Body() body: unknown) {
    this.check(secret);
    await this.payments.handleStkCallback(body);
    return ACCEPTED;
  }

  @Post('b2c-result/:secret')
  @HttpCode(200)
  async b2cResult(@Param('secret') secret: string, @Body() body: unknown) {
    this.check(secret);
    await this.withdrawals.handleB2cResult(body);
    return ACCEPTED;
  }

  /** Safaricom couldn't process the payout in time; finance must check it by hand. */
  @Post('b2c-timeout/:secret')
  @HttpCode(200)
  async b2cTimeout(@Param('secret') secret: string, @Body() body: unknown) {
    this.check(secret);
    const result = parseB2cCallback(body);
    if (result) {
      await this.prisma.withdrawal.updateMany({
        where: { providerReference: result.conversationId, status: 'APPROVED' },
        data: { status: 'ON_HOLD', note: 'M-Pesa timed out — check the payout status on the M-Pesa portal' },
      });
    }
    this.logger.warn(`B2C timeout: ${JSON.stringify(body).slice(0, 500)}`);
    return ACCEPTED;
  }
}

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly wallets: WalletsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Send the M-Pesa prompt again (e.g. the customer missed it). */
  @Post('orders/:id/pay')
  @HttpCode(200)
  @Roles('CUSTOMER')
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    const order = await this.payments.ensureOrderOwner(id, user.id);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });
    return this.payments.requestMpesaPayment(order, dto.phone ?? order.mpesaPhone ?? me.phone);
  }

  /** Check with M-Pesa if the confirmation hasn't arrived. */
  @Post('orders/:id/payment/refresh')
  @HttpCode(200)
  @Roles('CUSTOMER')
  async refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.refresh(id, user.id);
  }

  @Get('wallets')
  list(@CurrentUser() user: AuthUser) {
    return this.wallets.list(user.id);
  }

  @Get('wallets/withdrawals')
  myWithdrawals(@CurrentUser() user: AuthUser) {
    return this.wallets.withdrawals(user.id);
  }

  @Get('wallets/:type/transactions')
  transactions(@CurrentUser() user: AuthUser, @Param() { type }: WalletTypeParam, @Query() query: TransactionsQueryDto) {
    return this.wallets.transactions(user.id, type === 'runner' ? 'RUNNER' : 'CUSTOMER', query.page, query.pageSize);
  }

  @Post('wallets/:type/withdrawals')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  withdraw(@CurrentUser() user: AuthUser, @Param() { type }: WalletTypeParam, @Body() dto: WithdrawDto) {
    return this.withdrawals.request(user.id, type === 'runner' ? 'RUNNER' : 'CUSTOMER', dto.amount, dto.pin);
  }
}

/** Finance screens of the admin panel. */
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  /** Balances of the platform's own wallets. */
  @Get('finance/summary')
  @Staff('FINANCE_MANAGER')
  async summary() {
    const wallets = await this.prisma.wallet.findMany({
      where: { type: { in: ['PLATFORM_REVENUE', 'ESCROW', 'PAYOUT_PENDING', 'EXTERNAL_CLEARING'] }, userId: null },
      select: { type: true, balance: true },
    });
    const totals = await this.prisma.wallet.groupBy({ by: ['type'], where: { type: { in: ['CUSTOMER', 'RUNNER'] } }, _sum: { balance: true } });
    const balance = (type: string) => wallets.find((w) => w.type === type)?.balance ?? 0;
    return {
      platformRevenue: balance('PLATFORM_REVENUE'),
      escrowHeld: balance('ESCROW'),
      payoutsPending: balance('PAYOUT_PENDING'),
      customerWallets: totals.find((t) => t.type === 'CUSTOMER')?._sum.balance ?? 0,
      runnerWallets: totals.find((t) => t.type === 'RUNNER')?._sum.balance ?? 0,
      // Money M-Pesa holds for us (received minus paid out). Negative balance = asset.
      mpesaFloat: -balance('EXTERNAL_CLEARING'),
    };
  }

  @Get('escrows')
  @Staff('FINANCE_MANAGER', 'OPERATIONS_MANAGER')
  async escrows(@Query() query: EscrowListQueryDto) {
    const where = { status: query.status };
    const [total, items] = await Promise.all([
      this.prisma.escrow.count({ where }),
      this.prisma.escrow.findMany({
        where,
        orderBy: { heldAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { order: { select: { id: true, orderNumber: true, status: true, customerId: true, runnerId: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  @Get('payments')
  @Staff('FINANCE_MANAGER')
  async payments(@Query() query: PaymentListQueryDto) {
    const where = { status: query.status, ...(query.search ? { OR: [{ providerReceipt: query.search }, { phone: { contains: query.search } }] } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        omit: { rawCallback: true },
        include: { order: { select: { orderNumber: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  @Get('withdrawals')
  @Staff('FINANCE_MANAGER')
  async withdrawalList(@Query() query: WithdrawalListQueryDto) {
    const where = { status: query.status };
    const [total, items] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { wallet: { select: { type: true, user: { select: { id: true, firstName: true, lastName: true, phone: true } } } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  @Staff('FINANCE_MANAGER')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.withdrawals.approve(id, admin);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  @Staff('FINANCE_MANAGER')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.withdrawals.reject(id, dto.reason, admin);
  }

  @Post('withdrawals/:id/mark-paid')
  @HttpCode(200)
  @Staff('FINANCE_MANAGER')
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferenceDto, @CurrentUser() admin: AuthUser) {
    return this.withdrawals.markPaid(id, dto.reference, admin);
  }
}
