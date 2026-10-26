import { Injectable } from '@nestjs/common';
import { calculateQuote, withPricingDefaults, type PricingConfig, type QuoteInput } from '@errandconnect/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export const PRICING_SETTING_KEY = 'pricing';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current pricing set by admins, falling back to the defaults. */
  async getConfig(): Promise<PricingConfig> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: PRICING_SETTING_KEY } });
    return withPricingDefaults(setting?.value as unknown as Partial<PricingConfig> | undefined);
  }

  async quote(input: QuoteInput) {
    return calculateQuote(input, await this.getConfig());
  }
}
