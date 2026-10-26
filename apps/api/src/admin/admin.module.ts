import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { RunnersModule } from '../runners/runners.module.js';
import { AdminController } from './admin.controller.js';
import { AdminOpsController } from './ops.controller.js';
import { AdminOpsService } from './ops.service.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [RunnersModule, OrdersModule],
  controllers: [AdminController, AdminOpsController],
  providers: [AdminService, AdminOpsService],
})
export class AdminModule {}
