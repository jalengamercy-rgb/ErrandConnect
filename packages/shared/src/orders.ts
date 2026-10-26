import type { OrderStatus } from './constants';
import { haversineKm, type LatLng } from './geo';

/** Steps a runner moves an order through, in order. DELIVERED needs the customer's PIN. */
export const RUNNER_PROGRESS_STATUSES = ['AT_STORE', 'PICKED_UP', 'IN_TRANSIT'] as const;
export type RunnerProgressStatus = (typeof RUNNER_PROGRESS_STATUSES)[number];

/** The normal life of an order, used to decide which moves are forward. */
const FLOW: OrderStatus[] = [
  'AWAITING_PAYMENT',
  'PENDING',
  'ACCEPTED',
  'RUNNER_ASSIGNED',
  'AT_STORE',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
];

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'AWAITING_PAYMENT',
  'PENDING',
  'ACCEPTED',
  'RUNNER_ASSIGNED',
  'AT_STORE',
  'PICKED_UP',
  'IN_TRANSIT',
];
/** A runner is working on the order. */
export const RUNNER_ACTIVE_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'RUNNER_ASSIGNED', 'AT_STORE', 'PICKED_UP', 'IN_TRANSIT'];
/** Customers can cancel until the runner has picked the items up. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  'AWAITING_PAYMENT',
  'PENDING',
  'ACCEPTED',
  'RUNNER_ASSIGNED',
  'AT_STORE',
];
/** Runners can hand a job back (it goes back to PENDING) until they've picked items up. */
export const RUNNER_RELEASABLE_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'RUNNER_ASSIGNED', 'AT_STORE'];

/** True if moving from `from` to `to` goes forward in the normal flow (steps may be skipped). */
export function isForwardMove(from: OrderStatus, to: OrderStatus): boolean {
  const a = FLOW.indexOf(from);
  const b = FLOW.indexOf(to);
  return a >= 0 && b > a;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_APPROVAL: 'Waiting for company approval',
  AWAITING_PAYMENT: 'Waiting for payment',
  PENDING: 'Looking for a runner',
  ACCEPTED: 'Runner on the way',
  RUNNER_ASSIGNED: 'Runner assigned',
  AT_STORE: 'Runner at the store',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way to you',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  DISPUTED: 'Under review',
};

/**
 * Roads are rarely straight, so straight-line distance is multiplied by this
 * to estimate travel distance. Replaced by Google Maps road distance later.
 */
export const ROAD_DISTANCE_FACTOR = 1.3;

export function estimateRoadKm(a: LatLng, b: LatLng): number {
  return Math.round(haversineKm(a, b) * ROAD_DISTANCE_FACTOR * 10) / 10;
}

/**
 * Largest order total (KES) allowed per customer verification level.
 * Level 1 = phone, 2 = email, 3 = ID verified (no limit).
 */
export const ORDER_LIMIT_BY_LEVEL: Record<number, number | null> = { 1: 5_000, 2: 20_000, 3: null };

/** Runners see jobs within this distance when they haven't set a maximum. */
export const DEFAULT_JOB_RADIUS_KM = 20;
