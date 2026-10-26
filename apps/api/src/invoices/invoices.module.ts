import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminInvoicesController, InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [InvoicesController, AdminInvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
