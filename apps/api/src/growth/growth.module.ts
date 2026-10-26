import { Module, OnModuleInit } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';
import { BannersService } from './banners.service.js';
import { FeaturedService } from './featured.service.js';
import { GrowthSettingsService } from './growth-settings.service.js';
import { AdminGrowthController, GrowthController } from './growth.controller.js';
import { PromosService } from './promos.service.js';
import { RevenueService } from './revenue.service.js';
import { RewardsService } from './rewards.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SurgeService } from './surge.service.js';

/** Promo codes, surge pricing, Plus, loyalty, referrals, banners and featured listings. */
@Module({
  imports: [PaymentsModule],
  controllers: [GrowthController, AdminGrowthController],
  providers: [
    GrowthSettingsService,
    SurgeService,
    PromosService,
    SubscriptionsService,
    RewardsService,
    BannersService,
    FeaturedService,
    RevenueService,
  ],
  exports: [GrowthSettingsService, SurgeService, PromosService, SubscriptionsService, RewardsService],
})
export class GrowthModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit() {
    this.payments.setSubscriptionSettler((tx, id, amount, receipt, checkout) =>
      this.subscriptions.settleMpesa(tx, id, amount, receipt, checkout),
    );
  }
}
