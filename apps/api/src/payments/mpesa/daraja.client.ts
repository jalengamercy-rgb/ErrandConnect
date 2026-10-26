import { Logger } from '@nestjs/common';
import {
  MpesaClient,
  MpesaError,
  type B2cRequest,
  type B2cResponse,
  type StkPushRequest,
  type StkPushResponse,
  type StkQueryResult,
} from './mpesa.client.js';

export interface DarajaConfig {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  /** Paybill / till number that receives customer payments. */
  shortcode: string;
  passkey: string;
  /** Public HTTPS address of this API, e.g. https://api.errandconnect.co.ke */
  callbackBaseUrl: string;
  /** Random secret in callback URLs, since Safaricom doesn't sign callbacks. */
  callbackSecret: string;
  /** B2C (payouts) settings; optional until withdrawals go live. */
  b2cShortcode?: string;
  initiatorName?: string;
  /** Initiator password encrypted with Safaricom's certificate (generated on the Daraja portal). */
  securityCredential?: string;
}

/** "+254712345678" → "254712345678", the format Daraja expects. */
export const toDarajaPhone = (phone: string) => phone.replace(/^\+/, '');

/** YYYYMMDDHHmmss in Kenya time (UTC+3), as Daraja expects. */
export function darajaTimestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60_000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/**
 * Safaricom Daraja API client. Field names follow the Daraja documentation;
 * verify them against the current docs when credentials are set up.
 */
export class DarajaMpesaClient extends MpesaClient {
  readonly mode = 'daraja' as const;
  private readonly logger = new Logger(DarajaMpesaClient.name);
  private readonly baseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: DarajaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.baseUrl = config.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    const res = await this.fetchImpl(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new MpesaError('M-Pesa is unavailable right now. Please try again.');
    const body = (await res.json()) as { access_token: string; expires_in: string | number };
    // Refresh a minute early.
    this.token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) - 60) * 1000 };
    return this.token.value;
  }

  private async call<T>(path: string, payload: object): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as T & { errorMessage?: string; ResponseCode?: string };
    if (!res.ok || (body.ResponseCode !== undefined && body.ResponseCode !== '0')) {
      this.logger.warn(`Daraja ${path} failed: ${res.status} ${JSON.stringify(body)}`);
      throw new MpesaError('M-Pesa could not process the request. Please try again.');
    }
    return body;
  }

  private callbackUrl(path: string) {
    return `${this.config.callbackBaseUrl.replace(/\/$/, '')}/payments/mpesa/${path}/${this.config.callbackSecret}`;
  }

  async stkPush(request: StkPushRequest): Promise<StkPushResponse> {
    const timestamp = darajaTimestamp();
    const phone = toDarajaPhone(request.phone);
    const body = await this.call<{ MerchantRequestID: string; CheckoutRequestID: string; CustomerMessage: string }>(
      '/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: this.config.shortcode,
        Password: stkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: request.amount,
        PartyA: phone,
        PartyB: this.config.shortcode,
        PhoneNumber: phone,
        CallBackURL: this.callbackUrl('stk-callback'),
        AccountReference: request.accountReference.slice(0, 12),
        TransactionDesc: request.description.slice(0, 13),
      },
    );
    return { merchantRequestId: body.MerchantRequestID, checkoutRequestId: body.CheckoutRequestID, customerMessage: body.CustomerMessage };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    const timestamp = darajaTimestamp();
    try {
      const body = await this.call<{ ResultCode?: string; ResultDesc?: string }>('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: this.config.shortcode,
        Password: stkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      });
      return { resultCode: body.ResultCode !== undefined ? Number(body.ResultCode) : null, resultDesc: body.ResultDesc ?? '' };
    } catch {
      // Daraja returns an error while the customer is still deciding.
      return { resultCode: null, resultDesc: 'Still processing' };
    }
  }

  async b2c(request: B2cRequest): Promise<B2cResponse> {
    const { b2cShortcode, initiatorName, securityCredential } = this.config;
    if (!b2cShortcode || !initiatorName || !securityCredential) throw new MpesaError('Withdrawals are not set up yet');
    const body = await this.call<{ ConversationID: string; OriginatorConversationID: string }>('/mpesa/b2c/v3/paymentrequest', {
      OriginatorConversationID: request.originatorConversationId,
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayment',
      Amount: request.amount,
      PartyA: b2cShortcode,
      PartyB: toDarajaPhone(request.phone),
      Remarks: request.remarks.slice(0, 100),
      QueueTimeOutURL: this.callbackUrl('b2c-timeout'),
      ResultURL: this.callbackUrl('b2c-result'),
      Occasion: 'Withdrawal',
    });
    return { conversationId: body.ConversationID, originatorConversationId: body.OriginatorConversationID };
  }
}
