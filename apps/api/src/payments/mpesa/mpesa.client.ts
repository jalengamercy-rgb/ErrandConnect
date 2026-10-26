/** Asks the customer's phone to approve a payment (Lipa na M-Pesa Online / STK Push). */
export interface StkPushRequest {
  /** +2547XXXXXXXX */
  phone: string;
  amount: number;
  /** Shown on the customer's phone and M-Pesa statement (max 12 characters). */
  accountReference: string;
  description: string;
}

export interface StkPushResponse {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

export interface StkQueryResult {
  /** null while the customer hasn't answered yet; 0 = paid; anything else = failed or cancelled. */
  resultCode: number | null;
  resultDesc: string;
}

/** Sends money from the business to a phone (B2C), used for withdrawals. */
export interface B2cRequest {
  phone: string;
  amount: number;
  /** Our own unique ID for this payout. */
  originatorConversationId: string;
  remarks: string;
}

export interface B2cResponse {
  conversationId: string;
  originatorConversationId: string;
}

/** The parts of Safaricom's STK callback we use. */
export interface StkCallbackResult {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount?: number;
  receipt?: string;
  phone?: string;
}

export interface B2cCallbackResult {
  conversationId: string;
  originatorConversationId: string;
  resultCode: number;
  resultDesc: string;
  transactionId?: string;
}

/**
 * The M-Pesa operations the app needs. DarajaMpesaClient talks to Safaricom;
 * FakeMpesaClient simulates it for development and tests.
 */
export abstract class MpesaClient {
  abstract readonly mode: 'fake' | 'daraja';
  abstract stkPush(request: StkPushRequest): Promise<StkPushResponse>;
  abstract stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
  abstract b2c(request: B2cRequest): Promise<B2cResponse>;
}

/** Thrown when Safaricom refuses or can't be reached. The message is safe to show users. */
export class MpesaError extends Error {}

/** Reads Safaricom's STK callback body: { Body: { stkCallback: {...} } }. */
export function parseStkCallback(body: unknown): StkCallbackResult | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const items = (cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] } | undefined)?.Item ?? [];
  const item = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ''),
    amount: item('Amount') !== undefined ? Number(item('Amount')) : undefined,
    receipt: item('MpesaReceiptNumber') !== undefined ? String(item('MpesaReceiptNumber')) : undefined,
    phone: item('PhoneNumber') !== undefined ? String(item('PhoneNumber')) : undefined,
  };
}

/** Reads Safaricom's B2C result body: { Result: {...} }. */
export function parseB2cCallback(body: unknown): B2cCallbackResult | null {
  const r = (body as { Result?: Record<string, unknown> })?.Result;
  if (!r || typeof r.ConversationID !== 'string') return null;
  return {
    conversationId: r.ConversationID,
    originatorConversationId: String(r.OriginatorConversationID ?? ''),
    resultCode: Number(r.ResultCode),
    resultDesc: String(r.ResultDesc ?? ''),
    transactionId: typeof r.TransactionID === 'string' ? r.TransactionID : undefined,
  };
}
