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
 *
 * Every shilling the customer pays ends up with either the runner or the
 * platform, so:  customer.total === runner.total + platform.total
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

export interface PricingConfig {
  /** Commission the platform keeps from the errand fee (0-1). The plan says 10-20%. */
  commissionRate: number;
  /** Share of the delivery fee paid to the runner (0-1). The rest is platform margin. */
  deliveryRunnerShare: number;
  delivery: Record<DeliveryType, DeliveryRate>;
  /** Ordered from lowest to highest; the last tier should have below = null. */
  serviceFeeTiers: ServiceFeeTier[];
  urgency: Record<Urgency, UrgencyRate>;
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
};

export interface QuoteInput {
  itemsCost?: number;
  errandFee: number;
  distanceKm: number;
  deliveryType: DeliveryType;
  urgency?: Urgency;
}

export interface Quote {
  customer: {
    itemsCost: number;
    errandFee: number;
    deliveryFee: number;
    urgencyFee: number;
    serviceFee: number;
    total: number;
  };
  runner: {
    itemsReimbursement: number;
    errandEarnings: number;
    deliveryEarnings: number;
    urgencyEarnings: number;
    total: number;
  };
  platform: {
    commission: number;
    deliveryMargin: number;
    urgencyMargin: number;
    serviceFee: number;
    total: number;
  };
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

  const { fee: deliveryFee, extraKm } = deliveryFeeFor(input.distanceKm, deliveryRate);
  const urgencyFee = urgencyRate.fee;
  const serviceFee = serviceFeeFor(itemsCost + input.errandFee, config.serviceFeeTiers);

  // The platform's cut is rounded; the runner gets the exact remainder, so
  // nothing is lost or created by rounding.
  const commission = Math.round(input.errandFee * config.commissionRate);
  const deliveryMargin = Math.round(deliveryFee * (1 - config.deliveryRunnerShare));
  const urgencyMargin = Math.round(urgencyFee * (1 - urgencyRate.runnerShare));

  const runner = {
    itemsReimbursement: itemsCost,
    errandEarnings: input.errandFee - commission,
    deliveryEarnings: deliveryFee - deliveryMargin,
    urgencyEarnings: urgencyFee - urgencyMargin,
    total: 0,
  };
  runner.total = runner.itemsReimbursement + runner.errandEarnings + runner.deliveryEarnings + runner.urgencyEarnings;

  const platform = { commission, deliveryMargin, urgencyMargin, serviceFee, total: 0 };
  platform.total = commission + deliveryMargin + urgencyMargin + serviceFee;

  const customer = {
    itemsCost,
    errandFee: input.errandFee,
    deliveryFee,
    urgencyFee,
    serviceFee,
    total: itemsCost + input.errandFee + deliveryFee + urgencyFee + serviceFee,
  };

  return { customer, runner, platform, extraKm };
}
