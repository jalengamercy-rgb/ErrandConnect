import { DEFAULT_PRICING_CONFIG } from '@errandconnect/shared';
import { PricingService } from './pricing.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function serviceWithSetting(value: unknown) {
  const prisma = { platformSetting: { findUnique: vi.fn().mockResolvedValue(value ? { value } : null) } };
  return new PricingService(prisma as unknown as PrismaService);
}

describe('PricingService', () => {
  it('falls back to default pricing when admins have not set any', async () => {
    expect(await serviceWithSetting(null).getConfig()).toEqual(DEFAULT_PRICING_CONFIG);
  });

  it('uses the commission rate saved by admins', async () => {
    const service = serviceWithSetting({ ...DEFAULT_PRICING_CONFIG, commissionRate: 0.1 });
    const quote = await service.quote({ errandFee: 1000, distanceKm: 1, deliveryType: 'MOTORCYCLE' });
    expect(quote.platform.commission).toBe(100);
  });
});
