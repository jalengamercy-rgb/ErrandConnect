/** Commission merchants pay on the value of goods sold through ErrandCONNECT, unless an admin sets their own rate. */
export const DEFAULT_MERCHANT_COMMISSION_RATE = 0.1;

/** Days a business or merchant has to pay a monthly invoice. */
export const INVOICE_DUE_DAYS = 14;

/** Most deliveries in one bulk order. */
export const BULK_ORDER_LIMIT = 50;

export const COMPANY_SIZES = ['SIZE_1_10', 'SIZE_11_50', 'SIZE_51_200', 'SIZE_200_PLUS'] as const;
export const COMPANY_SIZE_LABELS: Record<(typeof COMPANY_SIZES)[number], string> = {
  SIZE_1_10: '1–10 employees',
  SIZE_11_50: '11–50',
  SIZE_51_200: '51–200',
  SIZE_200_PLUS: '200+',
};

export const MONTHLY_ORDER_ESTIMATES = ['UNDER_50', '50_100', '100_500', 'OVER_500'] as const;

/** Extras a business can ask for when registering. */
export const BUSINESS_FEATURES = [
  'DEDICATED_RUNNER',
  'PRIORITY_DELIVERY',
  'SCHEDULED_PICKUPS',
  'MULTIPLE_BRANCHES',
  'CORPORATE_WALLET',
  'TEAM_ACCOUNTS',
  'APPROVAL_WORKFLOW',
] as const;

/** Services a business can say it needs (from the business registration form). */
export const BUSINESS_SERVICES = [
  'DOCUMENT_DELIVERY',
  'COURIER',
  'OFFICE_SUPPLIES',
  'BULK_DELIVERIES',
  'STAFF_ERRANDS',
  'BANKING_ERRANDS',
  'SHOPPING',
  'FOOD_DELIVERY',
  'PARCEL_COLLECTION',
  'WAREHOUSE_PICKUP',
] as const;
