import { BadRequestException, Injectable } from '@nestjs/common';
import { validateGrowthConfig, withGrowthDefaults, type GrowthConfig } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const GROWTH_SETTING_KEY = 'growth';

/** Referral rewards, loyalty rates, Plus price and featured listing price. */
@Injectable()
export class GrowthSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private cache?: { at: number; config: GrowthConfig };

  /** Cached for 30 seconds: it's read on every completed errand and quote. */
  async get(): Promise<GrowthConfig> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.config;
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: GROWTH_SETTING_KEY } });
    const config = withGrowthDefaults(setting?.value as Partial<GrowthConfig> | undefined);
    this.cache = { at: Date.now(), config };
    return config;
  }

  async update(config: unknown, actorId: string) {
    const errors = validateGrowthConfig(config);
    if (errors.length) throw new BadRequestException(errors);
    const value = config as GrowthConfig;
    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.platformSetting.findUnique({ where: { key: GROWTH_SETTING_KEY } });
      await tx.platformSetting.upsert({
        where: { key: GROWTH_SETTING_KEY },
        update: { value: value as unknown as Prisma.InputJsonValue, updatedById: actorId },
        create: { key: GROWTH_SETTING_KEY, value: value as unknown as Prisma.InputJsonValue, updatedById: actorId },
      });
      await this.audit.log(
        {
          actorId,
          action: 'settings.growth.update',
          entityType: 'setting',
          entityId: GROWTH_SETTING_KEY,
          metadata: { before: previous?.value ?? null, after: value as unknown as Prisma.InputJsonValue },
        },
        tx,
      );
    });
    this.cache = undefined;
    return value;
  }
}
