import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesController } from './categories/categories.controller.js';
import { AuditModule } from './common/audit.service.js';
import { AuthGuard } from './common/auth.guard.js';
import { HttpThrottlerGuard } from './common/http-throttler.guard.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthController } from './health/health.controller.js';
import { MessagingModule } from './notifications/messaging.service.js';
import { OrdersModule } from './orders/orders.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { RealtimeServiceModule } from './realtime/realtime.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RunnersModule } from './runners/runners.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : '.env' }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ limit: 120, ttl: 60_000 }],
        // Tests make many requests from one address.
        skipIf: () => config.get('NODE_ENV') === 'test',
      }),
    }),
    PrismaModule,
    AuditModule,
    RealtimeServiceModule,
    PricingModule,
    MessagingModule,
    AuthModule,
    DocumentsModule,
    RunnersModule,
    OrdersModule,
    AdminModule,
  ],
  controllers: [HealthController, CategoriesController],
  providers: [
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    // Every route requires login unless marked @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
