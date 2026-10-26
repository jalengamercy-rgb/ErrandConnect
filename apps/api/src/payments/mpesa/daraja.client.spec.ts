import { DarajaMpesaClient, darajaTimestamp, stkPassword, toDarajaPhone } from './daraja.client.js';
import { MpesaError, parseB2cCallback, parseStkCallback } from './mpesa.client.js';

const config = {
  environment: 'sandbox' as const,
  consumerKey: 'key',
  consumerSecret: 'secret',
  shortcode: '174379',
  passkey: 'pass',
  callbackBaseUrl: 'https://api.example.com/',
  callbackSecret: 'cb-secret',
  b2cShortcode: '600000',
  initiatorName: 'testapi',
  securityCredential: 'encrypted',
};

/** A fetch stand-in that records requests and replies from a queue. */
function fakeFetch(...replies: { status?: number; body: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift()!;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const TOKEN = { body: { access_token: 'tok', expires_in: '3599' } };

describe('Daraja helpers', () => {
  it('formats phone, timestamp (Kenya time) and password', () => {
    expect(toDarajaPhone('+254712345678')).toBe('254712345678');
    expect(darajaTimestamp(new Date('2026-10-26T21:30:05Z'))).toBe('20261027003005');
    expect(stkPassword('174379', 'pass', '20261027003005')).toBe(Buffer.from('174379pass20261027003005').toString('base64'));
  });
});

describe('DarajaMpesaClient', () => {
  it('sends an STK push with the documented fields', async () => {
    const { fn, calls } = fakeFetch(TOKEN, {
      body: { MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_1', ResponseCode: '0', CustomerMessage: 'Success' },
    });
    const client = new DarajaMpesaClient(config, fn);
    const res = await client.stkPush({ phone: '+254712345678', amount: 866, accountReference: '202610263772X', description: 'ErrandCONNECT order' });

    expect(res).toEqual({ merchantRequestId: 'm1', checkoutRequestId: 'ws_CO_1', customerMessage: 'Success' });
    expect(calls[0].url).toBe('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials');
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    expect(calls[1].url).toBe('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body).toMatchObject({
      BusinessShortCode: '174379',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 866,
      PartyA: '254712345678',
      PartyB: '174379',
      PhoneNumber: '254712345678',
      CallBackURL: 'https://api.example.com/payments/mpesa/stk-callback/cb-secret',
      AccountReference: '202610263772',
      TransactionDesc: 'ErrandCONNECT',
    });
    expect(body.Password).toBe(stkPassword('174379', 'pass', body.Timestamp));
  });

  it('reuses the access token until it expires', async () => {
    const ok = { body: { MerchantRequestID: 'm', CheckoutRequestID: 'c', ResponseCode: '0', CustomerMessage: '' } };
    const { fn, calls } = fakeFetch(TOKEN, ok, ok);
    const client = new DarajaMpesaClient(config, fn);
    await client.stkPush({ phone: '+254712345678', amount: 1, accountReference: 'A', description: 'B' });
    await client.stkPush({ phone: '+254712345678', amount: 1, accountReference: 'A', description: 'B' });
    expect(calls.filter((c) => c.url.includes('oauth'))).toHaveLength(1);
  });

  it('turns Daraja errors into a friendly MpesaError', async () => {
    const { fn } = fakeFetch(TOKEN, { status: 400, body: { errorMessage: 'Bad Request - Invalid PhoneNumber' } });
    const client = new DarajaMpesaClient(config, fn);
    await expect(client.stkPush({ phone: '+254712345678', amount: 1, accountReference: 'A', description: 'B' })).rejects.toBeInstanceOf(MpesaError);
  });

  it('sends B2C payouts with result and timeout URLs', async () => {
    const { fn, calls } = fakeFetch(TOKEN, { body: { ConversationID: 'AG_1', OriginatorConversationID: 'o-1', ResponseCode: '0' } });
    const client = new DarajaMpesaClient(config, fn);
    const res = await client.b2c({ phone: '+254712345678', amount: 500, originatorConversationId: 'o-1', remarks: 'Withdrawal' });
    expect(res).toEqual({ conversationId: 'AG_1', originatorConversationId: 'o-1' });
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      OriginatorConversationID: 'o-1',
      InitiatorName: 'testapi',
      SecurityCredential: 'encrypted',
      CommandID: 'BusinessPayment',
      Amount: 500,
      PartyA: '600000',
      PartyB: '254712345678',
      ResultURL: 'https://api.example.com/payments/mpesa/b2c-result/cb-secret',
      QueueTimeOutURL: 'https://api.example.com/payments/mpesa/b2c-timeout/cb-secret',
    });
  });

  it('refuses B2C until payout credentials are configured', async () => {
    const client = new DarajaMpesaClient({ ...config, securityCredential: undefined }, fakeFetch().fn);
    await expect(client.b2c({ phone: '+254712345678', amount: 1, originatorConversationId: 'o', remarks: 'r' })).rejects.toThrow('not set up');
  });
});

describe('callback parsing', () => {
  it('reads a successful STK callback', () => {
    expect(
      parseStkCallback({
        Body: {
          stkCallback: {
            CheckoutRequestID: 'ws_CO_1',
            ResultCode: 0,
            ResultDesc: 'ok',
            CallbackMetadata: { Item: [{ Name: 'Amount', Value: 866 }, { Name: 'MpesaReceiptNumber', Value: 'SJK3ABC123' }, { Name: 'PhoneNumber', Value: 254712345678 }] },
          },
        },
      }),
    ).toEqual({ checkoutRequestId: 'ws_CO_1', resultCode: 0, resultDesc: 'ok', amount: 866, receipt: 'SJK3ABC123', phone: '254712345678' });
  });

  it('reads a cancelled STK callback without metadata, and rejects junk', () => {
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'c', ResultCode: 1032, ResultDesc: 'Cancelled' } } })).toMatchObject({ resultCode: 1032, amount: undefined });
    expect(parseStkCallback({ hello: 'world' })).toBeNull();
    expect(parseB2cCallback({ Result: { ConversationID: 'AG_1', ResultCode: 0, ResultDesc: 'ok', TransactionID: 'T1' } })).toMatchObject({ conversationId: 'AG_1', transactionId: 'T1' });
  });
});
