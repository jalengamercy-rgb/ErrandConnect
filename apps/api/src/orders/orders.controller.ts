import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../common/auth-user.js';
import {
  CancelDto,
  CreateOrderDto,
  DeliverDto,
  LocationUpdateDto,
  MessageDto,
  OrderDetailsDto,
  OrderListQueryDto,
  ProgressDto,
  ReviewDto,
} from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Price breakdown before confirming. */
  @Post('quote')
  @HttpCode(200)
  @Roles('CUSTOMER')
  async quote(@CurrentUser() user: AuthUser, @Body() dto: OrderDetailsDto) {
    const { quote, distanceKm, dropoff, promo, plus } = await this.orders.quote(user.id, dto);
    return { quote, distanceKm, dropoff, plus, promo: promo && { code: promo.code, discount: promo.discount, error: promo.error } };
  }

  @Post()
  @Roles('CUSTOMER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  /** The customer's own errands. */
  @Get()
  @Roles('CUSTOMER')
  list(@CurrentUser() user: AuthUser, @Query() query: OrderListQueryDto) {
    return this.orders.listForCustomer(user.id, query.scope);
  }

  /** Visible to the customer, the assigned runner and staff. */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForViewer(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('CUSTOMER')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.orders.cancelByCustomer(id, user.id, dto.reason);
  }

  /** Company owner/admin approves a member's errand. */
  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.approve(id, user.id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  rejectApproval(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.orders.rejectApproval(id, user.id, dto.reason);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('RUNNER')
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.accept(id, user.id);
  }

  @Post(':id/progress')
  @HttpCode(200)
  @Roles('RUNNER')
  progress(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto) {
    return this.orders.progress(id, user.id, dto.status, dto);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @Roles('RUNNER')
  deliver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) {
    return this.orders.deliver(id, user.id, dto.pin);
  }

  @Post(':id/release')
  @HttpCode(200)
  @Roles('RUNNER')
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.orders.release(id, user.id, dto.reason);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.listMessages(id, user.id);
  }

  @Post(':id/messages')
  sendMessage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    return this.orders.sendMessage(id, user.id, dto.body);
  }

  @Post(':id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.orders.review(id, user.id, dto);
  }
}

@Roles('RUNNER')
@Controller('runners/me')
export class RunnerJobsController {
  constructor(private readonly orders: OrdersService) {}

  /** Open errands near the runner that match their delivery type and services. */
  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.orders.availableJobs(user.id);
  }

  /** Errands this runner has taken. */
  @Get('orders')
  myOrders(@CurrentUser() user: AuthUser, @Query() query: OrderListQueryDto) {
    return this.orders.listForRunner(user.id, query.scope);
  }

  /** Sent every few seconds by the app while online, for live tracking. */
  @Put('location')
  location(@CurrentUser() user: AuthUser, @Body() dto: LocationUpdateDto) {
    return this.orders.updateRunnerLocation(user.id, dto.lat, dto.lng);
  }
}
