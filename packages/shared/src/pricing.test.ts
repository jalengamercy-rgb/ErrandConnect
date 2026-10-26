import { describe, expect, it } from 'vitest';
import { DELIVERY_TYPES, URGENCY_LEVELS } from './constants';
import { calculateQuote, DEFAULT_PRICING_CONFIG, deliveryFeeFor, PricingError, serviceFeeFor } from './pricing';
import { haversineKm } from './geo';

describe('calculateQuote', () => {
  it('matches the KES 2,000 example from the business plan', () => {
    // Plan: errand 2,000 + delivery 200 + service fee 50 = 2,250.
    // Runner gets 1,700 from the errand; platform keeps 300 commission + 50 service fee.
    const quote = calculateQuote({ errandFee: 2000, distanceKm: 2, deliveryType: 'MOTORCYCLE' });

    expect(quote.customer).toEqual({
      itemsCost: 0,
      errandFee: 2000,
      deliveryFee: 200,
      urgencyFee: 0,
      serviceFee: 50,
      total: 2250,
    });
    expect(quote.runner.errandEarnings).toBe(1700);
    expect(quote.platform.commission).toBe(300);
    expect(quote.platform.serviceFee).toBe(50);
    // Delivery margin: runner gets 80% of 200 = 160, platform keeps 40.
    expect(quote.runner.deliveryEarnings).toBe(160);
    expect(quote.platform.deliveryMargin).toBe(40);
  });

  it('passes items cost straight to the runner with no commission', () => {
    const quote = calculateQuote({ itemsCost: 3500, errandFee: 300, distanceKm: 1, deliveryType: 'MOTORCYCLE' });
    expect(quote.runner.itemsReimbursement).toBe(3500);
    expect(quote.platform.commission).toBe(45);
    // Service fee tier uses items + errand fee = 3,800, so KES 50.
    expect(quote.customer.serviceFee).toBe(50);
  });

  it('charges per km beyond the included distance', () => {
    // Motorcycle: 200 base covers 2 km, then 40/km. 5.5 km = 3.5 extra km = 140.
    const quote = calculateQuote({ errandFee: 500, distanceKm: 5.5, deliveryType: 'MOTORCYCLE' });
    expect(quote.extraKm).toBe(3.5);
    expect(quote.customer.deliveryFee).toBe(340);
  });

  it('adds the urgency premium and shares it with the runner', () => {
    const quote = calculateQuote({ errandFee: 500, distanceKm: 1, deliveryType: 'BICYCLE', urgency: 'WITHIN_15_MIN' });
    expect(quote.customer.urgencyFee).toBe(350);
    expect(quote.runner.urgencyEarnings).toBe(245);
    expect(quote.platform.urgencyMargin).toBe(105);
  });

  it('never loses or creates a shilling: customer total = runner + platform', () => {
    for (const deliveryType of DELIVERY_TYPES) {
      for (const urgency of URGENCY_LEVELS) {
        for (const errandFee of [0, 1, 7, 333, 999, 1000, 4999, 5000, 12345]) {
          for (const distanceKm of [0, 0.3, 1.99, 2, 2.01, 7.77, 42]) {
            const q = calculateQuote({ itemsCost: 17, errandFee, distanceKm, deliveryType, urgency });
            expect(q.customer.total).toBe(q.runner.total + q.platform.total);
            expect(Number.isInteger(q.customer.total)).toBe(true);
          }
        }
      }
    }
  });

  it('rejects invalid input', () => {
    expect(() => calculateQuote({ errandFee: -1, distanceKm: 1, deliveryType: 'CAR' })).toThrow(PricingError);
    expect(() => calculateQuote({ errandFee: 10.5, distanceKm: 1, deliveryType: 'CAR' })).toThrow(PricingError);
    expect(() => calculateQuote({ errandFee: 100, distanceKm: NaN, deliveryType: 'CAR' })).toThrow(PricingError);
    expect(() =>
      calculateQuote({ errandFee: 100, distanceKm: 1, deliveryType: 'CAR' }, { ...DEFAULT_PRICING_CONFIG, commissionRate: 1.5 }),
    ).toThrow(PricingError);
  });
});

describe('serviceFeeFor', () => {
  it('picks the right tier at the boundaries', () => {
    const tiers = DEFAULT_PRICING_CONFIG.serviceFeeTiers;
    expect(serviceFeeFor(999, tiers)).toBe(30);
    expect(serviceFeeFor(1000, tiers)).toBe(50);
    expect(serviceFeeFor(4999, tiers)).toBe(50);
    expect(serviceFeeFor(5000, tiers)).toBe(100);
  });
});

describe('deliveryFeeFor', () => {
  it('does not round up floating-point noise', () => {
    // 2.3 - 2 = 0.2999999999999998 in JavaScript; should bill 0.3 km, not 0.4.
    expect(deliveryFeeFor(2.3, { baseFee: 200, includedKm: 2, perKm: 100 }).extraKm).toBe(0.3);
  });
});

describe('haversineKm', () => {
  it('measures Nairobi CBD to Westlands as about 2.2 km in a straight line', () => {
    const cbd = { lat: -1.2864, lng: 36.8172 };
    const westlands = { lat: -1.2676, lng: 36.8108 };
    expect(haversineKm(cbd, westlands)).toBeCloseTo(2.2, 0);
  });
});
