/**
 * Growth and revenue settings: referrals, loyalty points and the
 * ErrandCONNECT Plus subscription. Admins change these in the admin panel.
 * All money is whole shillings.
 */

export interface GrowthConfig {
  referral: {
    enabled: boolean;
    /** Wallet credit for the person who invited, after the new user's first completed errand. */
    referrerReward: number;
    /** Wallet credit for the new user after their first completed errand. */
    refereeReward: number;
  };
  loyalty: {
    enabled: boolean;
    /** Points earned for every KES 100 a customer spends on completed errands. */
    pointsPer100: number;
    /** Shillings of wallet credit for every 100 points redeemed. */
    valuePer100Points: number;
    minRedeemPoints: number;
    /** Plus members earn this many times the points. */
    plusMultiplier: number;
  };
  plus: {
    enabled: boolean;
    /** Price for 30 days. */
    monthlyPrice: number;
  };
  featured: {
    /** What a shop pays to appear at the top of the shop directory for 7 days. */
    weeklyPrice: number;
  };
}

export const DEFAULT_GROWTH_CONFIG: GrowthConfig = {
  referral: { enabled: true, referrerReward: 200, refereeReward: 100 },
  loyalty: { enabled: true, pointsPer100: 1, valuePer100Points: 50, minRedeemPoints: 100, plusMultiplier: 2 },
  plus: { enabled: true, monthlyPrice: 499 },
  featured: { weeklyPrice: 1000 },
};

export const MAX_FEATURED_WEEKS = 8;

export const PLUS_PERIOD_DAYS = 30;
export const PLUS_BENEFITS = ['No service fee on any errand', 'Double loyalty points', 'Priority support'] as const;

/** Fills in sections missing from a saved config. */
export function withGrowthDefaults(config: Partial<GrowthConfig> | null | undefined): GrowthConfig {
  const c = config ?? {};
  return {
    referral: { ...DEFAULT_GROWTH_CONFIG.referral, ...c.referral },
    loyalty: { ...DEFAULT_GROWTH_CONFIG.loyalty, ...c.loyalty },
    plus: { ...DEFAULT_GROWTH_CONFIG.plus, ...c.plus },
    featured: { ...DEFAULT_GROWTH_CONFIG.featured, ...c.featured },
  };
}

export function validateGrowthConfig(config: unknown): string[] {
  const c = config as Partial<GrowthConfig> | null;
  if (!c || typeof c !== 'object') return ['Growth settings must be an object'];
  const errors: string[] = [];
  const money = (v: unknown, max = 100_000) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
  const bool = (v: unknown) => typeof v === 'boolean';

  if (!bool(c.referral?.enabled)) errors.push('referral.enabled must be true or false');
  if (!money(c.referral?.referrerReward, 10_000)) errors.push('referral.referrerReward must be 0 - 10,000 shillings');
  if (!money(c.referral?.refereeReward, 10_000)) errors.push('referral.refereeReward must be 0 - 10,000 shillings');

  if (!bool(c.loyalty?.enabled)) errors.push('loyalty.enabled must be true or false');
  if (!money(c.loyalty?.pointsPer100, 100)) errors.push('loyalty.pointsPer100 must be 0 - 100');
  if (!money(c.loyalty?.valuePer100Points, 100)) errors.push('loyalty.valuePer100Points must be 0 - 100 shillings');
  if (!(money(c.loyalty?.minRedeemPoints, 100_000) && (c.loyalty!.minRedeemPoints as number) >= 100))
    errors.push('loyalty.minRedeemPoints must be at least 100');
  if (!(typeof c.loyalty?.plusMultiplier === 'number' && c.loyalty.plusMultiplier >= 1 && c.loyalty.plusMultiplier <= 5))
    errors.push('loyalty.plusMultiplier must be between 1 and 5');

  if (!bool(c.plus?.enabled)) errors.push('plus.enabled must be true or false');
  if (!(money(c.plus?.monthlyPrice, 50_000) && (c.plus!.monthlyPrice as number) >= 10))
    errors.push('plus.monthlyPrice must be 10 - 50,000 shillings');
  if (!(money(c.featured?.weeklyPrice, 100_000) && (c.featured!.weeklyPrice as number) >= 10))
    errors.push('featured.weeklyPrice must be 10 - 100,000 shillings');
  return errors;
}

// ─── Loyalty ───

export const LOYALTY_TIERS = [
  { name: 'Bronze', minPoints: 0 },
  { name: 'Silver', minPoints: 500 },
  { name: 'Gold', minPoints: 2000 },
] as const;

/** Tier from points earned over the customer's lifetime (redeeming doesn't lower it). */
export function loyaltyTierFor(lifetimePoints: number) {
  let index = 0;
  while (index + 1 < LOYALTY_TIERS.length && lifetimePoints >= LOYALTY_TIERS[index + 1].minPoints) index++;
  const next = LOYALTY_TIERS[index + 1];
  return { tier: LOYALTY_TIERS[index].name, nextTier: next?.name ?? null, pointsToNext: next ? next.minPoints - lifetimePoints : 0 };
}

/** Points earned for a completed errand (items bought count too: the customer spent it through us). */
export function loyaltyPointsFor(amountPaid: number, loyalty: GrowthConfig['loyalty'], isPlus: boolean): number {
  if (!loyalty.enabled || amountPaid <= 0) return 0;
  return Math.floor(amountPaid / 100) * loyalty.pointsPer100 * (isPlus ? Math.round(loyalty.plusMultiplier) : 1);
}

/** Wallet credit for redeeming points; only whole blocks of 100 points count. */
export function loyaltyValueFor(points: number, loyalty: GrowthConfig['loyalty']): { points: number; amount: number } {
  const blocks = Math.floor(points / 100);
  return { points: blocks * 100, amount: blocks * loyalty.valuePer100Points };
}

// ─── Promo codes ───

export const PROMO_TYPES = ['PERCENT', 'FIXED'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export interface PromoRule {
  type: PromoType;
  /** Percent (1-100) or shillings. */
  value: number;
  /** Cap for percent promos. */
  maxDiscount: number | null;
}

/**
 * Discount on our fees (errand, delivery, urgency, surge, service). Items the
 * runner buys are never discounted: that money is passed straight through.
 */
export function promoDiscountFor(rule: PromoRule, fees: number): number {
  if (fees <= 0) return 0;
  const raw = rule.type === 'PERCENT' ? Math.round((fees * rule.value) / 100) : rule.value;
  return Math.max(0, Math.min(raw, rule.maxDiscount ?? Infinity, fees));
}

/** "WELCOME 100" style codes: 3-20 capital letters and digits. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9]{3,20}$/;
