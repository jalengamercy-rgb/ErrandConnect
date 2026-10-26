import type { DeliveryType } from './constants';

/**
 * Insights: fraud/risk rules and simple, explainable predictions (demand,
 * delivery time, churn). Everything is plain statistics on our own data, so
 * staff can see why a number is what it is. Swap in trained models later.
 */

// ─── Risk rules ───

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export const RISK_RULES = {
  CUSTOMER_CANCELS: { title: 'Cancels a lot after a runner accepts', severity: 'MEDIUM' },
  DISPUTE_HEAVY: { title: 'Reports many problems', severity: 'MEDIUM' },
  RUNNER_RELEASES: { title: 'Runner hands back many jobs', severity: 'MEDIUM' },
  PIN_GUESSING: { title: 'Wrong delivery PINs entered', severity: 'HIGH' },
  FAR_FROM_DROPOFF: { title: 'Delivered far from the drop-off point', severity: 'MEDIUM' },
  LOW_RATED_RUNNER: { title: 'Runner rated poorly', severity: 'MEDIUM' },
  REFERRAL_BURST: { title: 'Many referral rewards in a short time', severity: 'HIGH' },
  // Mobile networks in Kenya put many people behind one IP address, so this is only a hint.
  SHARED_IP_PROMO: { title: 'Same promo code used by several new accounts on one network', severity: 'MEDIUM' },
  PAYMENT_FAILURES: { title: 'Many failed M-Pesa payments', severity: 'LOW' },
  SAME_PAIR: { title: 'Same runner keeps serving the same customer', severity: 'MEDIUM' },
  NEW_ACCOUNT_BIG_ORDER: { title: 'Large first errand from a new account', severity: 'LOW' },
} as const satisfies Record<string, { title: string; severity: RiskSeverity }>;

export type RiskRule = keyof typeof RISK_RULES;

/** Thresholds, kept together so they are easy to tune. */
export const RISK_LIMITS = {
  cancelsAfterAccept30d: 5,
  disputes30d: 3,
  disputesHigh30d: 5,
  releases7d: 4,
  wrongPinOrders30d: 2,
  farFromDropoffKm: 1,
  farDeliveries30d: 3,
  lowRating: 3,
  lowRatingMinReviews: 5,
  referralRewards7d: 5,
  sharedIpPromoAccounts: 3,
  paymentFailures24h: 5,
  samePairOrders7d: 5,
  newAccountHours: 24,
  newAccountBigOrder: 3000,
} as const;

/** Score 0-100 used to sort the review queue. */
export function riskScore(severity: RiskSeverity, timesOverLimit = 1): number {
  const base = { LOW: 20, MEDIUM: 50, HIGH: 80 }[severity];
  return Math.min(100, Math.round(base + Math.max(0, timesOverLimit - 1) * 10));
}

/** Monday-based week number, so a dismissed flag stays dismissed for that week. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Delivery time ───

export interface EtaModel {
  /** Minutes before moving (getting to the pickup, shopping, queueing). */
  intercept: number;
  /** Minutes per km of the trip. */
  perKm: number;
  /** Completed errands the model learnt from; 0 = default guess. */
  samples: number;
}

/** Typical Nairobi speeds (km/h) and fixed time, used until there is enough history. */
const DEFAULT_KMH: Record<DeliveryType, number> = {
  WALKING: 5,
  BICYCLE: 12,
  MOTORCYCLE: 25,
  CAR: 18,
  VAN: 16,
  PICKUP: 16,
  TRUCK: 14,
};
export const DEFAULT_ETA_FIXED_MINUTES = 20;
export const MIN_ETA_SAMPLES = 10;

export function defaultEtaModel(deliveryType: DeliveryType): EtaModel {
  return { intercept: DEFAULT_ETA_FIXED_MINUTES, perKm: 60 / DEFAULT_KMH[deliveryType], samples: 0 };
}

/** Least-squares straight line through (x, y) points. */
export function fitLinear(points: { x: number; y: number }[]): { intercept: number; slope: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const slope = sxy / sxx;
  return { intercept: meanY - slope * meanX, slope };
}

/**
 * Learns minutes = intercept + perKm × distance from completed errands
 * (accepted → completed). Falls back to the default when data is thin or odd.
 */
export function fitEtaModel(deliveryType: DeliveryType, history: { distanceKm: number; minutes: number }[]): EtaModel {
  const fallback = defaultEtaModel(deliveryType);
  // Ignore errands under a minute (tests, mistakes) or that sat for hours (forgotten); they aren't travel time.
  const clean = history.filter((h) => h.minutes >= 1 && h.minutes < 6 * 60 && h.distanceKm >= 0);
  if (clean.length < MIN_ETA_SAMPLES) return fallback;
  const fit = fitLinear(clean.map((h) => ({ x: h.distanceKm, y: h.minutes })));
  // A negative slope or intercept means the data doesn't explain distance yet.
  if (!fit || fit.slope <= 0 || fit.intercept < 0) {
    const avg = clean.reduce((s, h) => s + h.minutes, 0) / clean.length;
    return { intercept: Math.round(avg), perKm: 0, samples: clean.length };
  }
  return { intercept: Math.round(fit.intercept * 10) / 10, perKm: Math.round(fit.slope * 100) / 100, samples: clean.length };
}

export function predictMinutes(model: EtaModel, distanceKm: number): number {
  return Math.max(5, Math.round(model.intercept + model.perKm * distanceKm));
}

/** An errand is running late once it takes 30% (and at least 10 minutes) longer than predicted. */
export function isRunningLate(predictedMinutes: number, elapsedMinutes: number): boolean {
  return elapsedMinutes > predictedMinutes * 1.3 && elapsedMinutes - predictedMinutes >= 10;
}

// ─── Demand ───

/** Errands one runner can usually handle per hour. */
export const ERRANDS_PER_RUNNER_HOUR = 1.5;

/**
 * Expected errands for an hour from the same weekday and hour in past weeks
 * (most recent first). Recent weeks count more.
 */
export function forecastFromHistory(sameHourPastWeeks: number[]): number {
  if (sameHourPastWeeks.length === 0) return 0;
  let weighted = 0;
  let weights = 0;
  sameHourPastWeeks.forEach((count, i) => {
    const w = 1 / (i + 1);
    weighted += count * w;
    weights += w;
  });
  return Math.round((weighted / weights) * 10) / 10;
}

export function runnersNeeded(expectedErrands: number): number {
  return Math.ceil(expectedErrands / ERRANDS_PER_RUNNER_HOUR);
}

/** Map grid of about 2 km, for "where" questions. */
export const AREA_CELL_DEGREES = 0.02;
export function areaCell(lat: number, lng: number): { key: string; lat: number; lng: number } {
  const cLat = Math.floor(lat / AREA_CELL_DEGREES) * AREA_CELL_DEGREES + AREA_CELL_DEGREES / 2;
  const cLng = Math.floor(lng / AREA_CELL_DEGREES) * AREA_CELL_DEGREES + AREA_CELL_DEGREES / 2;
  return { key: `${cLat.toFixed(3)},${cLng.toFixed(3)}`, lat: Number(cLat.toFixed(4)), lng: Number(cLng.toFixed(4)) };
}

// ─── Churn ───

export type ChurnRisk = 'ACTIVE' | 'AT_RISK' | 'LIKELY_LOST' | 'LOST';

/** Days after which a customer counts as lost no matter their usual rhythm. */
export const CHURN_LOST_DAYS = 90;

/**
 * Compares the time since the last errand with the person's usual gap between
 * errands (at least a week). Twice the usual gap = at risk, four times = likely lost.
 */
export function churnRisk(orderCount: number, daysSinceLast: number, avgGapDays: number | null): { risk: ChurnRisk; ratio: number } {
  if (orderCount === 0) return { risk: 'LOST', ratio: Infinity };
  const usualGap = Math.max(7, avgGapDays ?? 14);
  const ratio = Math.round((daysSinceLast / usualGap) * 10) / 10;
  if (daysSinceLast >= CHURN_LOST_DAYS) return { risk: 'LOST', ratio };
  if (ratio >= 4) return { risk: 'LIKELY_LOST', ratio };
  if (ratio >= 2) return { risk: 'AT_RISK', ratio };
  return { risk: 'ACTIVE', ratio };
}
