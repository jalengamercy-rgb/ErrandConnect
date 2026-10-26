import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROWTH_CONFIG,
  loyaltyPointsFor,
  loyaltyTierFor,
  loyaltyValueFor,
  promoDiscountFor,
  validateGrowthConfig,
  withGrowthDefaults,
} from './growth';

const loyalty = DEFAULT_GROWTH_CONFIG.loyalty;

describe('loyalty', () => {
  it('earns points per KES 100, doubled for Plus', () => {
    expect(loyaltyPointsFor(99, loyalty, false)).toBe(0);
    expect(loyaltyPointsFor(1250, loyalty, false)).toBe(12);
    expect(loyaltyPointsFor(1250, loyalty, true)).toBe(24);
    expect(loyaltyPointsFor(1250, { ...loyalty, enabled: false }, true)).toBe(0);
  });

  it('redeems whole blocks of 100 points', () => {
    expect(loyaltyValueFor(250, loyalty)).toEqual({ points: 200, amount: 100 });
    expect(loyaltyValueFor(99, loyalty)).toEqual({ points: 0, amount: 0 });
  });

  it('names the tier from lifetime points', () => {
    expect(loyaltyTierFor(0)).toEqual({ tier: 'Bronze', nextTier: 'Silver', pointsToNext: 500 });
    expect(loyaltyTierFor(600)).toEqual({ tier: 'Silver', nextTier: 'Gold', pointsToNext: 1400 });
    expect(loyaltyTierFor(5000)).toEqual({ tier: 'Gold', nextTier: null, pointsToNext: 0 });
  });
});

describe('promoDiscountFor', () => {
  it('applies percent with a cap, and fixed amounts up to the fees', () => {
    expect(promoDiscountFor({ type: 'PERCENT', value: 20, maxDiscount: null }, 455)).toBe(91);
    expect(promoDiscountFor({ type: 'PERCENT', value: 50, maxDiscount: 150 }, 455)).toBe(150);
    expect(promoDiscountFor({ type: 'FIXED', value: 100, maxDiscount: null }, 455)).toBe(100);
    expect(promoDiscountFor({ type: 'FIXED', value: 1000, maxDiscount: null }, 455)).toBe(455);
  });
});

describe('growth settings', () => {
  it('accepts the defaults and fills in missing sections', () => {
    expect(validateGrowthConfig(DEFAULT_GROWTH_CONFIG)).toEqual([]);
    expect(withGrowthDefaults({ plus: { enabled: false, monthlyPrice: 299 } })).toEqual({
      ...DEFAULT_GROWTH_CONFIG,
      plus: { enabled: false, monthlyPrice: 299 },
    });
  });

  it('reports problems', () => {
    expect(
      validateGrowthConfig({
        ...DEFAULT_GROWTH_CONFIG,
        referral: { enabled: true, referrerReward: -5, refereeReward: 100 },
        plus: { enabled: true, monthlyPrice: 0 },
      }),
    ).toEqual(['referral.referrerReward must be 0 - 10,000 shillings', 'plus.monthlyPrice must be 10 - 50,000 shillings']);
  });
});
