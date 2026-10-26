import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { DisputesService } from './disputes.service.js';
import { AdminSupportController, SupportController } from './support.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [DisputesService, TicketsService],
})
export class SupportModule {}
