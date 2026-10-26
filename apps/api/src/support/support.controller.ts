import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import { DisputesService } from './disputes.service.js';
import {
  CreateTicketDto,
  DisputeListQueryDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
  TicketListQueryDto,
  TicketReplyDto,
  UpdateTicketDto,
} from './support.dto.js';
import { TicketsService } from './tickets.service.js';

@Controller()
export class SupportController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly tickets: TicketsService,
  ) {}

  /** Customer or runner reports a problem with an errand. */
  @Post('orders/:id/disputes')
  raiseDispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseDisputeDto) {
    return this.disputes.raise(id, user.id, dto);
  }

  @Post('support/tickets')
  createTicket(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user.id, dto);
  }

  @Get('support/tickets')
  myTickets(@CurrentUser() user: AuthUser) {
    return this.tickets.listForUser(user.id);
  }

  @Get('support/tickets/:id')
  myTicket(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForUser(id, user.id);
  }

  @Post('support/tickets/:id/messages')
  @HttpCode(200)
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketReplyDto) {
    return this.tickets.replyAsUser(id, user.id, dto.message);
  }
}

@Controller('admin')
export class AdminSupportController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly tickets: TicketsService,
  ) {}

  @Get('disputes')
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT')
  listDisputes(@Query() query: DisputeListQueryDto) {
    return this.disputes.list(query);
  }

  @Get('disputes/:id')
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT')
  getDispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.get(id);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto, @CurrentUser() admin: AuthUser) {
    return this.disputes.resolve(id, dto, admin);
  }

  @Get('tickets')
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER')
  listTickets(@Query() query: TicketListQueryDto, @CurrentUser() staff: AuthUser) {
    return this.tickets.list(query, staff);
  }

  @Get('tickets/:id')
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER')
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForStaff(id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(200)
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER')
  replyTicket(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketReplyDto, @CurrentUser() staff: AuthUser) {
    return this.tickets.replyAsStaff(id, staff, dto.message);
  }

  @Patch('tickets/:id')
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER')
  updateTicket(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.tickets.update(id, dto);
  }
}
