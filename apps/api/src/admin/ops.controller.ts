import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import {
  AddStaffDto,
  BroadcastDto,
  CategoryCreateDto,
  CategoryUpdateDto,
  CsvQueryDto,
  DaysQueryDto,
  HideReviewDto,
  ReviewListQueryDto,
  UpdateStaffDto,
} from './ops.dto.js';
import { MfaService } from '../auth/mfa.service.js';
import { AdminOpsService } from './ops.service.js';

// SUPER_ADMIN can use every route; the roles listed are the others allowed.
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly mfa: MfaService,
  ) {}

  /** Summary cards for the dashboard. Any staff member can see it. */
  @Get('dashboard')
  @Staff()
  dashboard() {
    return this.ops.dashboard();
  }

  @Get('reports/daily')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MARKETING_MANAGER')
  daily(@Query() query: DaysQueryDto) {
    return this.ops.dailySeries(query.days);
  }

  @Get('reports/categories')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MARKETING_MANAGER')
  categoriesReport(@Query() query: DaysQueryDto) {
    return this.ops.categoryBreakdown(query.days);
  }

  @Get('reports/top-runners')
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'FINANCE_MANAGER')
  topRunners(@Query() query: DaysQueryDto) {
    return this.ops.topRunners(query.days);
  }

  /** Spreadsheet of orders between two dates. */
  @Get('reports/orders.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="orders.csv"')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER')
  ordersCsv(@Query() query: CsvQueryDto) {
    return this.ops.ordersCsv(new Date(query.from), new Date(query.to));
  }

  @Get('live-map')
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'CUSTOMER_SUPPORT')
  liveMap() {
    return this.ops.liveMap();
  }

  @Get('settings/pricing')
  @Staff('FINANCE_MANAGER', 'OPERATIONS_MANAGER')
  pricing() {
    return this.ops.getPricing();
  }

  @Put('settings/pricing')
  @Staff('FINANCE_MANAGER')
  updatePricing(@Body() body: unknown, @CurrentUser() admin: AuthUser) {
    return this.ops.updatePricing(body, admin);
  }

  @Get('categories')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'CONTENT_MANAGER')
  categories() {
    return this.ops.listCategories();
  }

  @Post('categories')
  @Staff('OPERATIONS_MANAGER')
  createCategory(@Body() dto: CategoryCreateDto, @CurrentUser() admin: AuthUser) {
    return this.ops.createCategory(dto, admin);
  }

  @Patch('categories/:slug')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER')
  updateCategory(@Param('slug') slug: string, @Body() dto: CategoryUpdateDto, @CurrentUser() admin: AuthUser) {
    return this.ops.updateCategory(slug, dto, admin);
  }

  @Get('reviews')
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  reviews(@Query() query: ReviewListQueryDto) {
    return this.ops.listReviews(query);
  }

  @Post('reviews/:id/visibility')
  @HttpCode(200)
  @Staff('CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER')
  hideReview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HideReviewDto, @CurrentUser() admin: AuthUser) {
    return this.ops.setReviewHidden(id, dto.hidden, admin);
  }

  @Get('customers/:id')
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT')
  customer(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.customer(id);
  }

  @Post('notifications')
  @Staff('OPERATIONS_MANAGER', 'MARKETING_MANAGER')
  broadcast(@Body() dto: BroadcastDto, @CurrentUser() admin: AuthUser) {
    return this.ops.broadcast(dto, admin);
  }

  @Get('staff')
  @Staff('SUPER_ADMIN')
  staff() {
    return this.ops.listStaff();
  }

  @Post('staff')
  @Staff('SUPER_ADMIN')
  addStaff(@Body() dto: AddStaffDto, @CurrentUser() admin: AuthUser) {
    return this.ops.addStaff(dto, admin);
  }

  @Patch('staff/:userId')
  @Staff('SUPER_ADMIN')
  updateStaff(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateStaffDto, @CurrentUser() admin: AuthUser) {
    return this.ops.updateStaff(userId, dto.role, admin);
  }

  /** For staff who lost their authenticator phone. */
  @Delete('staff/:userId/mfa')
  @Staff('SUPER_ADMIN')
  resetStaffMfa(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() admin: AuthUser) {
    return this.mfa.reset(userId, admin);
  }

  @Delete('staff/:userId')
  @Staff('SUPER_ADMIN')
  removeStaff(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() admin: AuthUser) {
    return this.ops.removeStaff(userId, admin);
  }
}
