import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReasonDto } from '../admin/admin.dto.js';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import { GenerateInvoiceDto, InvoiceListQueryDto, MarkInvoicePaidDto, PayInvoiceDto } from './invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** Invoices of companies and shops the user owns or administers. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.invoices.listForUser(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.getForUser(id, user.id);
  }

  /** Sends an M-Pesa prompt to pay the invoice. */
  @Post(':id/pay')
  @HttpCode(200)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayInvoiceDto) {
    return this.invoices.pay(id, user.id, dto.phone);
  }
}

@Controller('admin/invoices')
@Staff('FINANCE_MANAGER')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@Query() query: InvoiceListQueryDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post('generate')
  generate(@Body() dto: GenerateInvoiceDto, @CurrentUser() admin: AuthUser) {
    return this.invoices.generate(dto, admin);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkInvoicePaidDto, @CurrentUser() admin: AuthUser) {
    return this.invoices.markPaid(id, dto.reference, admin);
  }

  @Post(':id/void')
  @HttpCode(200)
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.invoices.void(id, dto.reason, admin);
  }
}
