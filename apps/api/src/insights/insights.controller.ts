import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import { ChurnQueryDto, DemandQueryDto, ReviewFlagDto, RiskFlagQueryDto, WinBackDto } from './insights.dto.js';
import { PredictionsService } from './predictions.service.js';
import { RiskService } from './risk.service.js';

@Controller('admin/insights')
export class InsightsController {
  constructor(
    private readonly risk: RiskService,
    private readonly predictions: PredictionsService,
  ) {}

  /** Numbers for the dashboard. */
  @Get('summary')
  @Staff()
  async summary() {
    const [flags, late, demand] = await Promise.all([
      this.risk.list({ status: 'OPEN', page: 1, pageSize: 1 }),
      this.predictions.lateErrands(),
      this.predictions.demand(3),
    ]);
    const high = await this.risk.list({ status: 'OPEN', severity: 'HIGH', page: 1, pageSize: 1 });
    return {
      openFlags: flags.total,
      highRiskFlags: high.total,
      lateErrands: late.length,
      nextHours: demand.forecast,
      onlineRunners: demand.onlineRunners,
      shortAreas: demand.hotspots.filter((h) => h.shortfall > 0).length,
    };
  }

  @Get('risk-flags')
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER')
  flags(@Query() query: RiskFlagQueryDto) {
    return this.risk.list(query);
  }

  @Post('risk-flags/:id/review')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewFlagDto, @CurrentUser() admin: AuthUser) {
    return this.risk.review(id, dto.decision, dto.note, admin);
  }

  /** Runs every rule now (it also runs hourly). */
  @Post('risk/scan')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER')
  scan() {
    return this.risk.scan();
  }

  @Get('demand')
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'MARKETING_MANAGER')
  demand(@Query() query: DemandQueryDto) {
    return this.predictions.demand(query.hours ?? 24);
  }

  @Get('delivery-times')
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER')
  async deliveryTimes() {
    const [models, late] = await Promise.all([this.predictions.etaModels(), this.predictions.lateErrands()]);
    return { models, late };
  }

  @Get('churn/customers')
  @Staff('MARKETING_MANAGER', 'OPERATIONS_MANAGER')
  churnCustomers(@Query() query: ChurnQueryDto) {
    return this.predictions.churnCustomers(query.risk);
  }

  @Get('churn/runners')
  @Staff('RUNNER_MANAGER', 'OPERATIONS_MANAGER', 'MARKETING_MANAGER')
  inactiveRunners() {
    return this.predictions.inactiveRunners();
  }

  @Post('churn/win-back')
  @HttpCode(200)
  @Staff('MARKETING_MANAGER', 'RUNNER_MANAGER')
  winBack(@Body() dto: WinBackDto, @CurrentUser() admin: AuthUser) {
    return this.predictions.winBack(dto.userIds, dto.title, dto.message, dto.promoCode, admin);
  }
}
