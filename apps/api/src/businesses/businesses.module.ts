import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminBusinessesController, BusinessesController } from './businesses.controller.js';
import { BusinessesService } from './businesses.service.js';

@Module({
  imports: [OrdersModule],
  controllers: [BusinessesController, AdminBusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
