import { Module } from '@nestjs/common';
import { AdminMerchantsController, MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';

@Module({
  controllers: [MerchantsController, AdminMerchantsController],
  providers: [MerchantsService],
})
export class MerchantsModule {}
