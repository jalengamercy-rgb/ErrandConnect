import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { OrdersController, RunnerJobsController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController, RunnerJobsController],
  providers: [OrdersService, RealtimeGateway],
  exports: [OrdersService],
})
export class OrdersModule {}
