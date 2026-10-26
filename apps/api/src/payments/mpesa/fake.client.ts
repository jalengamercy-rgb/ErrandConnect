import { Logger } from '@nestjs/common';
import { randomCode, randomToken } from '../../common/crypto.js';
import { MpesaClient, type B2cRequest, type B2cResponse, type StkPushRequest, type StkPushResponse, type StkQueryResult } from './mpesa.client.js';

type CallbackSink = (kind: 'stk' | 'b2c', body: unknown) => Promise<unknown>;

/**
 * Pretends to be M-Pesa so the app works without Safaricom credentials.
 * With `autoConfirm`, it "approves" every payment a few seconds later by
 * sending the same callback Safaricom would. Tests turn this off and send
 * callbacks themselves.
 */
export class FakeMpesaClient extends MpesaClient {
  readonly mode = 'fake' as const;
  private readonly logger = new Logger(FakeMpesaClient.name);
  private sink: CallbackSink | null = null;

  constructor(
    private readonly autoConfirm: boolean,
    private readonly delayMs = 3000,
  ) {
    super();
  }

  /** Where simulated callbacks are delivered. */
  onCallback(sink: CallbackSink) {
    this.sink = sink;
  }

  async stkPush(request: StkPushRequest): Promise<StkPushResponse> {
    const checkoutRequestId = `ws_CO_FAKE_${randomToken(9)}`;
    this.logger.log(`[fake M-Pesa] STK push KES ${request.amount} to ${request.phone} (${checkoutRequestId})`);
    if (this.autoConfirm) {
      this.later('stk', {
        Body: {
          stkCallback: {
            MerchantRequestID: `fake-${randomToken(6)}`,
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: request.amount },
                { Name: 'MpesaReceiptNumber', Value: `FAKE${randomCode(6)}` },
                { Name: 'PhoneNumber', Value: Number(request.phone.replace('+', '')) },
              ],
            },
          },
        },
      });
    }
    return { merchantRequestId: `fake-${randomToken(6)}`, checkoutRequestId, customerMessage: 'Success. Request accepted for processing' };
  }

  async stkQuery(): Promise<StkQueryResult> {
    return { resultCode: null, resultDesc: 'Still processing' };
  }

  async b2c(request: B2cRequest): Promise<B2cResponse> {
    const conversationId = `AG_FAKE_${randomToken(9)}`;
    this.logger.log(`[fake M-Pesa] B2C KES ${request.amount} to ${request.phone} (${conversationId})`);
    if (this.autoConfirm) {
      this.later('b2c', {
        Result: {
          ResultType: 0,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          OriginatorConversationID: request.originatorConversationId,
          ConversationID: conversationId,
          TransactionID: `FAKE${randomCode(6)}`,
        },
      });
    }
    return { conversationId, originatorConversationId: request.originatorConversationId };
  }

  private later(kind: 'stk' | 'b2c', body: unknown) {
    setTimeout(() => {
      this.sink?.(kind, body).catch((error) => this.logger.error(`Simulated ${kind} callback failed`, error));
    }, this.delayMs).unref();
  }
}
