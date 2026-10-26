import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PricingService } from './pricing.service.js';
import { QuoteRequestDto } from './quote.dto.js';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Price breakdown for an errand, shown to the customer before they confirm. */
  @Post('quote')
  @HttpCode(200)
  quote(@Body() body: QuoteRequestDto) {
    return this.pricing.quote(body);
  }
}
