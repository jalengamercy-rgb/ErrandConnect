// Values shared across the whole platform. The database enums in
// apps/api/prisma/schema.prisma use the same names.

export const CURRENCY = 'KES';

export const DELIVERY_TYPES = [
  'WALKING',
  'BICYCLE',
  'MOTORCYCLE',
  'CAR',
  'VAN',
  'PICKUP',
  'TRUCK',
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/** How fast the customer wants the errand done. STANDARD has no premium. */
export const URGENCY_LEVELS = ['STANDARD', 'WITHIN_1_HOUR', 'WITHIN_30_MIN', 'WITHIN_15_MIN'] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'RUNNER_ASSIGNED',
  'AT_STORE',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'DISPUTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
