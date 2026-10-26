/** How customers can pay for an errand. */
/** BUSINESS_INVOICE: charged to a company's credit and paid on the monthly invoice. */
export const PAYMENT_METHODS = ['MPESA', 'WALLET', 'CASH', 'BUSINESS_INVOICE'] as const;
export type PaymentMethodChoice = (typeof PAYMENT_METHODS)[number];

/** Smallest withdrawal to M-Pesa, in KES. */
export const MIN_WITHDRAWAL = 100;
/** Withdrawals up to this amount are paid out automatically; larger ones need an admin. */
export const AUTO_APPROVE_WITHDRAWAL_LIMIT = 5_000;
/** Largest single withdrawal (Safaricom's B2C limit is 150,000). */
export const MAX_WITHDRAWAL = 150_000;
/**
 * Runners collecting cash owe the platform its fee, which is taken from their
 * wallet. Once they owe more than this, they can't take more cash jobs until
 * M-Pesa earnings (or a top-up) clear it.
 */
export const CASH_DEBT_LIMIT = 1_000;
