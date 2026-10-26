import type { DeliveryType, Urgency } from './constants';

/**
 * ErrandCONNECT pricing engine.
 *
 * All amounts are whole Kenyan shillings (integers). M-Pesa only accepts whole
 * shillings, and integers avoid floating-point rounding errors.
 *
 * What the customer pays:
 *   itemsCost   - money the runner spends on the customer's behalf (groceries,
 *                 medicine...). Passed straight back to the runner, no commission.
 *   errandFee   - the price of the runner's service. The platform takes a commission.
 *   deliveryFee - base fee (covers the first few km) + a charge per extra km.
 *   urgencyFee  - optional premium for 15 min / 30 min / 1 hour delivery.
 *   serviceFee  - small flat platform fee, tiered by order value. Also covers escrow.
 *                 Waived for ErrandCONNECT Plus members.
 *   surgeFee    - extra delivery charge when there are more errands than runners
 *                 nearby. Mostly paid to the runner to bring more runners online.
 *   discount    - promo code, paid for by the platform (never by the runner).
 *
 * Every shilling the customer pays ends up with either the runner or the
 * platform, so:  customer.total === runner.total + platform.total
 * (platform.total can be negative when a big discount costs more than it earns).
 */

export interface DeliveryRate {
  /** Flat fee that covers the first `includedKm` kilometres. */
  baseFee: number;
  includedKm: number;
  /** Charge for each kilometre beyond `includedKm`. */
  perKm: number;
}

export interface ServiceFeeTier {
  /** The tier applies while order value is below this amount. null = no upper limit. */
  below: number | null;
  fee: number;
}

export interface UrgencyRate {
  fee: number;
  /** Share of the urgency fee paid to the runner (0-1), as an incentive to hurry. */
  runnerShare: number;
}

export interface SurgeConfig {
  enabled: boolean;
  /** Highest multiplier on the delivery fee, e.g. 2 = delivery can cost at most double. */
  maxMultiplier: number;
  /** Share of the surge fee paid to the runner (0-1). */
  runnerShare: number;
  /** Errands and runners within this distance count towards demand. */
  radiusKm: number;
  /** Set by operations for events such as heavy rain; demand surge can only raise it. 1 = off. */
  manualMultiplier: number;
}

export interface PricingConfig {
  /** Commission the platform keeps from the errand fee (0-1). The plan says 10-20%. */
  commissionRate: number;
  /** Share of the delivery fee paid to the runner (0-1). The rest is platform margin. */
  deliveryRunnerShare: number;
  delivery: Record<DeliveryType, DeliveryRate>;
  /** Ordered from lowest to highest; the last tier should have below = null. */
  serviceFeeTiers: ServiceFeeTier[];
  urgency: Record<Urgency, UrgencyRate>;
  surge: SurgeConfig;
}

/**
 * Starting values. These are placeholders until the business decides real
 * prices; in Phase 4 admins will change them from the Commission Settings screen.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  commissionRate: 0.15,
  deliveryRunnerShare: 0.8,
  delivery: {
    WALKING: { baseFee: 100, includedKm: 1, perKm: 50 },
    BICYCLE: { baseFee: 120, includedKm: 2, perKm: 30 },
    MOTORCYCLE: { baseFee: 200, includedKm: 2, perKm: 40 },
    CAR: { baseFee: 350, includedKm: 2, perKm: 60 },
    VAN: { baseFee: 800, includedKm: 3, perKm: 90 },
    PICKUP: { baseFee: 1000, includedKm: 3, perKm: 100 },
    TRUCK: { baseFee: 2500, includedKm: 5, perKm: 150 },
  },
  serviceFeeTiers: [
    { below: 1000, fee: 30 },
    { below: 5000, fee: 50 },
    { below: null, fee: 100 },
  ],
  urgency: {
    STANDARD: { fee: 0, runnerShare: 0 },
    WITHIN_1_HOUR: { fee: 100, runnerShare: 0.7 },
    WITHIN_30_MIN: { fee: 200, runnerShare: 0.7 },
    WITHIN_15_MIN: { fee: 350, runnerShare: 0.7 },
  },
  // Off until operations switch it on from the pricing settings.
  surge: { enabled: false, maxMultiplier: 2, runnerShare: 0.8, radiusKm: 3, manualMultiplier: 1 },
};

/** Fills in settings added after a config was saved (e.g. surge), so old saved configs keep working. */
export function withPricingDefaults(config: Partial<PricingConfig> | null | undefined): PricingConfig {
  if (!config) return DEFAULT_PRICING_CONFIG;
  return { ...DEFAULT_PRICING_CONFIG, ...config, surge: { ...DEFAULT_PRICING_CONFIG.surge, ...config.surge } };
}

/**
 * Demand-based surge: 1 while runners keep up, rising by 25% for each extra
 * open errand per runner nearby, capped at maxMultiplier. Rounded to 0.1.
 */
export function surgeMultiplierFor(openErrands: number, onlineRunners: number, surge: SurgeConfig): number {
  if (!surge.enabled) return 1;
  const ratio = onlineRunners === 0 ? (openErrands > 0 ? Infinity : 0) : openErrands / onlineRunners;
  const demand = ratio <= 1 ? 1 : 1 + (ratio - 1) * 0.25;
  const multiplier = Math.min(surge.maxMultiplier, Math.max(demand, surge.manualMultiplier, 1));
  return Math.round(multiplier * 10) / 10;
}

export interface QuoteInput {
  itemsCost?: number;
  errandFee: number;
  distanceKm: number;
  deliveryType: DeliveryType;
  urgency?: Urgency;
  /** 1 = no surge. */
  surgeMultiplier?: number;
  /** ErrandCONNECT Plus members pay no service fee. */
  waiveServiceFee?: boolean;
  /** Promo discount; capped so the customer never pays less than the runner's share. */
  discount?: number;
}

export interface Quote {
  customer: {
    itemsCost: number;
    errandFee: number;
    deliveryFee: number;
    urgencyFee: number;
    surgeFee: number;
    serviceFee: number;
    discount: number;
    total: number;
  };
  runner: {
    itemsReimbursement: number;
    errandEarnings: number;
    deliveryEarnings: number;
    urgencyEarnings: number;
    surgeEarnings: number;
    total: number;
  };
  platform: {
    commission: number;
    deliveryMargin: number;
    urgencyMargin: number;
    surgeMargin: number;
    serviceFee: number;
    /** Negative: the platform pays for promo discounts. */
    discount: number;
    total: number;
  };
  /** Delivery fee multiplier used (1 = no surge). */
  surgeMultiplier: number;
  /** Kilometres charged beyond the base fee's included distance. */
  extraKm: number;
}

export class PricingError extends Error {}

function assertWholeShillings(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new PricingError(`${name} must be a whole number of shillings, 0 or more (got ${value})`);
  }
}

function assertRate(name: string, value: number): void {
  if (!(value >= 0 && value <= 1)) {
    throw new PricingError(`${name} must be between 0 and 1 (got ${value})`);
  }
}

export function serviceFeeFor(orderValue: number, tiers: ServiceFeeTier[]): number {
  for (const tier of tiers) {
    if (tier.below === null || orderValue < tier.below) return tier.fee;
  }
  throw new PricingError('serviceFeeTiers must end with a tier where below = null');
}

export function deliveryFeeFor(distanceKm: number, rate: DeliveryRate): { fee: number; extraKm: number } {
  // Round extra distance up to the next 0.1 km so customers aren't charged for a
  // full kilometre they didn't travel. toFixed strips floating-point noise
  // (e.g. 0.30000000004) that would otherwise round up an extra 0.1 km.
  const tenthsOfKm = Number((Math.max(0, distanceKm - rate.includedKm) * 10).toFixed(6));
  const extraKm = Math.ceil(tenthsOfKm) / 10;
  return { fee: rate.baseFee + Math.round(extraKm * rate.perKm), extraKm };
}

export function calculateQuote(input: QuoteInput, config: PricingConfig = DEFAULT_PRICING_CONFIG): Quote {
  const itemsCost = input.itemsCost ?? 0;
  const urgency = input.urgency ?? 'STANDARD';

  assertWholeShillings('itemsCost', itemsCost);
  assertWholeShillings('errandFee', input.errandFee);
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
    throw new PricingError(`distanceKm must be 0 or more (got ${input.distanceKm})`);
  }
  assertRate('commissionRate', config.commissionRate);
  assertRate('deliveryRunnerShare', config.deliveryRunnerShare);

  const deliveryRate = config.delivery[input.deliveryType];
  if (!deliveryRate) throw new PricingError(`Unknown delivery type: ${input.deliveryType}`);
  const urgencyRate = config.urgency[urgency];
  if (!urgencyRate) throw new PricingError(`Unknown urgency: ${urgency}`);
  assertRate('urgency runnerShare', urgencyRate.runnerShare);

  const surgeMultiplier = input.surgeMultiplier ?? 1;
  if (!(surgeMultiplier >= 1 && surgeMultiplier <= 10))
    throw new PricingError(`surgeMultiplier must be between 1 and 10 (got ${surgeMultiplier})`);
  const surgeRunnerShare = config.surge?.runnerShare ?? DEFAULT_PRICING_CONFIG.surge.runnerShare;
  assertRate('surge runnerShare', surgeRunnerShare);

  const { fee: deliveryFee, extraKm } = deliveryFeeFor(input.distanceKm, deliveryRate);
  const urgencyFee = urgencyRate.fee;
  const surgeFee = Math.round(deliveryFee * (surgeMultiplier - 1));
  const serviceFee = input.waiveServiceFee ? 0 : serviceFeeFor(itemsCost + input.errandFee, config.serviceFeeTiers);

  // The platform's cut is rounded; the runner gets the exact remainder, so
  // nothing is lost or created by rounding.
  const commission = Math.round(input.errandFee * config.commissionRate);
  const deliveryMargin = Math.round(deliveryFee * (1 - config.deliveryRunnerShare));
  const urgencyMargin = Math.round(urgencyFee * (1 - urgencyRate.runnerShare));
  const surgeMargin = Math.round(surgeFee * (1 - surgeRunnerShare));

  const runner = {
    itemsReimbursement: itemsCost,
    errandEarnings: input.errandFee - commission,
    deliveryEarnings: deliveryFee - deliveryMargin,
    urgencyEarnings: urgencyFee - urgencyMargin,
    surgeEarnings: surgeFee - surgeMargin,
    total: 0,
  };
  runner.total =
    runner.itemsReimbursement + runner.errandEarnings + runner.deliveryEarnings + runner.urgencyEarnings + runner.surgeEarnings;

  const gross = itemsCost + input.errandFee + deliveryFee + urgencyFee + surgeFee + serviceFee;
  const requested = input.discount ?? 0;
  assertWholeShillings('discount', requested);
  // The runner is always paid in full, so the discount can't go below their share.
  const discount = Math.min(requested, gross - runner.total);

  const platform = { commission, deliveryMargin, urgencyMargin, surgeMargin, serviceFee, discount: -discount, total: 0 };
  platform.total = commission + deliveryMargin + urgencyMargin + surgeMargin + serviceFee - discount;

  const customer = {
    itemsCost,
    errandFee: input.errandFee,
    deliveryFee,
    urgencyFee,
    surgeFee,
    serviceFee,
    discount,
    total: gross - discount,
  };

  return { customer, runner, platform, extraKm, surgeMultiplier };
}

/**
 * Checks a pricing config (e.g. one edited in the admin panel).
 * Returns a list of problems; empty means it's valid.
 */
export function validatePricingConfig(config: unknown): string[] {
  const errors: string[] = [];
  const c = config as Partial<PricingConfig> | null;
  const money = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000;
  const rate = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
  if (!c || typeof c !== 'object') return ['Pricing must be an object'];

  if (!rate(c.commissionRate)) errors.push('commissionRate must be between 0 and 1');
  if (!rate(c.deliveryRunnerShare)) errors.push('deliveryRunnerShare must be between 0 and 1');

  for (const type of ['WALKING', 'BICYCLE', 'MOTORCYCLE', 'CAR', 'VAN', 'PICKUP', 'TRUCK'] as const) {
    const d = c.delivery?.[type];
    if (!d || !money(d.baseFee) || !money(d.perKm) || !(typeof d.includedKm === 'number' && d.includedKm >= 0 && d.includedKm <= 100)) {
      errors.push(`delivery.${type} needs whole-shilling baseFee and perKm, and includedKm between 0 and 100`);
    }
  }

  const tiers = c.serviceFeeTiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    errors.push('serviceFeeTiers needs at least one tier');
  } else {
    tiers.forEach((t, i) => {
      if (!money(t?.fee)) errors.push(`serviceFeeTiers[${i}].fee must be whole shillings`);
      const last = i === tiers.length - 1;
      if (last ? t?.below !== null : !money(t?.below))
        errors.push(`serviceFeeTiers[${i}].below must be ${last ? 'null (no upper limit)' : 'whole shillings'}`);
      if (i > 0 && !last && money(t?.below) && money(tiers[i - 1]?.below) && t.below! <= tiers[i - 1].below!) {
        errors.push('serviceFeeTiers must go from lowest to highest');
      }
    });
  }

  for (const level of ['STANDARD', 'WITHIN_1_HOUR', 'WITHIN_30_MIN', 'WITHIN_15_MIN'] as const) {
    const u = c.urgency?.[level];
    if (!u || !money(u.fee) || !rate(u.runnerShare))
      errors.push(`urgency.${level} needs a whole-shilling fee and runnerShare between 0 and 1`);
  }

  // Older saved configs have no surge section; it then uses the defaults.
  if (c.surge !== undefined) {
    const s = c.surge as Partial<SurgeConfig> | null;
    if (!s || typeof s.enabled !== 'boolean') errors.push('surge.enabled must be true or false');
    const multiplier = (v: unknown) => typeof v === 'number' && v >= 1 && v <= 5;
    if (!multiplier(s?.maxMultiplier)) errors.push('surge.maxMultiplier must be between 1 and 5');
    if (!multiplier(s?.manualMultiplier)) errors.push('surge.manualMultiplier must be between 1 and 5');
    if (multiplier(s?.maxMultiplier) && multiplier(s?.manualMultiplier) && s!.manualMultiplier! > s!.maxMultiplier!)
      errors.push('surge.manualMultiplier cannot be above surge.maxMultiplier');
    if (!rate(s?.runnerShare)) errors.push('surge.runnerShare must be between 0 and 1');
    if (!(typeof s?.radiusKm === 'number' && s.radiusKm > 0 && s.radiusKm <= 50)) errors.push('surge.radiusKm must be between 0 and 50');
  }
  return errors;
}
