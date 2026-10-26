import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles, Staff, type AuthUser } from '../common/auth-user.js';
import { BannersService } from './banners.service.js';
import { FeaturedService } from './featured.service.js';
import { GrowthSettingsService } from './growth-settings.service.js';
import {
  AutoRenewDto,
  BannerDto,
  BannerEventDto,
  BannerPaymentDto,
  CreatePromoDto,
  FeatureShopDto,
  PromoListQueryDto,
  RedeemPointsDto,
  RevenueQueryDto,
  SubscribeDto,
  UpdatePromoDto,
} from './growth.dto.js';
import { PromosService } from './promos.service.js';
import { RevenueService } from './revenue.service.js';
import { RewardsService } from './rewards.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { PartialType } from '@nestjs/mapped-types';

class UpdateBannerDto extends PartialType(BannerDto) {}

@Controller()
export class GrowthController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly banners: BannersService,
    private readonly featured: FeaturedService,
  ) {}

  /** Loyalty points and referral stats. */
  @Get('me/rewards')
  @Roles('CUSTOMER')
  rewardsSummary(@CurrentUser() user: AuthUser) {
    return this.rewards.summary(user.id);
  }

  @Post('me/rewards/redeem')
  @HttpCode(200)
  @Roles('CUSTOMER')
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemPointsDto) {
    return this.rewards.redeem(user.id, dto.points);
  }

  @Get('me/plus')
  plus(@CurrentUser() user: AuthUser) {
    return this.subscriptions.get(user.id);
  }

  @Post('me/plus')
  @HttpCode(200)
  @Roles('CUSTOMER')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.subscriptions.subscribe(user.id, dto.method, dto.phone);
  }

  /** Turn renewal off (stays Plus until the period ends) or back on. */
  @Patch('me/plus')
  setAutoRenew(@CurrentUser() user: AuthUser, @Body() dto: AutoRenewDto) {
    return this.subscriptions.setAutoRenew(user.id, dto.autoRenew);
  }

  @Get('banners')
  liveBanners(@CurrentUser() user: AuthUser) {
    return this.banners.forUser(user);
  }

  @Post('banners/:id/events')
  @HttpCode(200)
  trackBanner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerEventDto) {
    return this.banners.track(id, dto.event);
  }

  @Get('merchants/:id/featured')
  featuredOffer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.featured.offer(id, user.id);
  }

  /** Buy featured placement: issues an invoice, optionally with an M-Pesa prompt. */
  @Post('merchants/:id/featured')
  buyFeatured(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FeatureShopDto) {
    return this.featured.buy(id, user.id, dto.weeks, dto.phone);
  }
}

@Controller('admin')
export class AdminGrowthController {
  constructor(
    private readonly settings: GrowthSettingsService,
    private readonly promos: PromosService,
    private readonly banners: BannersService,
    private readonly revenue: RevenueService,
  ) {}

  @Get('settings/growth')
  @Staff('FINANCE_MANAGER', 'MARKETING_MANAGER', 'OPERATIONS_MANAGER')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings/growth')
  @Staff('FINANCE_MANAGER', 'MARKETING_MANAGER')
  updateSettings(@Body() body: unknown, @CurrentUser() admin: AuthUser) {
    return this.settings.update(body, admin.id);
  }

  @Get('promos')
  @Staff('MARKETING_MANAGER', 'FINANCE_MANAGER')
  listPromos(@Query() query: PromoListQueryDto) {
    return this.promos.list(query);
  }

  @Post('promos')
  @Staff('MARKETING_MANAGER')
  createPromo(@Body() dto: CreatePromoDto, @CurrentUser() admin: AuthUser) {
    return this.promos.create(dto, admin.id);
  }

  @Patch('promos/:id')
  @Staff('MARKETING_MANAGER')
  updatePromo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromoDto, @CurrentUser() admin: AuthUser) {
    return this.promos.update(id, dto, admin.id);
  }

  @Get('banners')
  @Staff('MARKETING_MANAGER', 'FINANCE_MANAGER')
  listBanners() {
    return this.banners.list();
  }

  @Post('banners')
  @Staff('MARKETING_MANAGER')
  createBanner(@Body() dto: BannerDto, @CurrentUser() admin: AuthUser) {
    return this.banners.create(dto, admin);
  }

  @Patch('banners/:id')
  @Staff('MARKETING_MANAGER')
  updateBanner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBannerDto, @CurrentUser() admin: AuthUser) {
    return this.banners.update(id, dto, admin);
  }

  /** Money received from an advertiser. */
  @Post('banners/:id/payments')
  @Staff('FINANCE_MANAGER')
  bannerPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerPaymentDto, @CurrentUser() admin: AuthUser) {
    return this.banners.recordPayment(id, dto.amount, dto.reference, admin);
  }

  @Get('reports/revenue')
  @Staff('FINANCE_MANAGER', 'OPERATIONS_MANAGER')
  revenueReport(@Query() query: RevenueQueryDto) {
    return this.revenue.report(query.from, query.to);
  }
}
