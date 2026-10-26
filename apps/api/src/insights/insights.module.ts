import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller.js';
import { PredictionsService } from './predictions.service.js';
import { RiskService } from './risk.service.js';

/** Fraud/risk rules and demand, delivery-time and churn predictions. */
@Module({
  controllers: [InsightsController],
  providers: [RiskService, PredictionsService],
  exports: [RiskService, PredictionsService],
})
export class InsightsModule {}
