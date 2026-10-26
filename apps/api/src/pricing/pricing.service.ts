import { Injectable } from '@nestjs/common';
import { calculateQuote, withPricingDefaults, type PricingConfig, type QuoteInput } from '@errandconnect/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export const PRICING_SETTING_KEY = 'pricing';
/** Every quote needs the pricing, so it's kept in memory briefly. Other API instances pick up changes within this time. */
const CACHE_MS = 30_000;

@Injectable()
export class PricingService {
  private cache?: { at: number; config: PricingConfig };

  constructor(private readonly prisma: PrismaService) {}

  /** Current pricing set by admins, falling back to the defaults. */
  async getConfig(): Promise<PricingConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.config;
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: PRICING_SETTING_KEY } });
    const config = withPricingDefaults(setting?.value as unknown as Partial<PricingConfig> | undefined);
    this.cache = { at: Date.now(), config };
    return config;
  }

  /** Call after saving new pricing so this instance uses it at once. */
  invalidate() {
    this.cache = undefined;
  }

  async quote(input: QuoteInput) {
    return calculateQuote(input, await this.getConfig());
  }
}
