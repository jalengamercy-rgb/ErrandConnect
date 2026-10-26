import { Module } from '@nestjs/common';
import { InsightsModule } from '../insights/insights.module.js';
import { GrowthModule } from '../growth/growth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { OrdersController, RunnerJobsController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [PaymentsModule, GrowthModule, InsightsModule],
  controllers: [OrdersController, RunnerJobsController],
  providers: [OrdersService, RealtimeGateway],
  exports: [OrdersService],
})
export class OrdersModule {}
