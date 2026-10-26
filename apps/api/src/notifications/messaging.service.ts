import { Global, Injectable, Logger, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OutgoingMessage {
  channel: 'SMS' | 'EMAIL';
  to: string;
  subject?: string;
  body: string;
  sentAt: Date;
}

/**
 * Sends SMS and email.
 *
 * SMS goes through Africa's Talking when AT_USERNAME and AT_API_KEY are set
 * (AT_USERNAME=sandbox uses their free sandbox). Otherwise, outside
 * production, messages are written to the log and kept in `outbox` so
 * developers and tests can read OTP codes. No email provider is connected yet.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  readonly outbox: OutgoingMessage[] = [];

  constructor(private readonly config: ConfigService) {}

  private get production() {
    return this.config.get('NODE_ENV') === 'production';
  }

  async sendSms(to: string, body: string): Promise<void> {
    const username = this.config.get<string>('AT_USERNAME');
    const apiKey = this.config.get<string>('AT_API_KEY');
    if (username && apiKey) return this.sendViaAfricasTalking(username, apiKey, to, body);
    this.deliver({ channel: 'SMS', to, body, sentAt: new Date() });
  }

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    if (this.production) throw new ServiceUnavailableException('Email is not available yet. Please try again later');
    this.deliver({ channel: 'EMAIL', to, subject, body, sentAt: new Date() });
  }

  /** Latest message sent to an address (dev/test helper). */
  lastMessageTo(to: string): OutgoingMessage | undefined {
    return this.outbox.findLast((m) => m.to === to);
  }

  private async sendViaAfricasTalking(username: string, apiKey: string, to: string, body: string) {
    const host = username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const form = new URLSearchParams({ username, to, message: body });
    const senderId = this.config.get<string>('AT_SENDER_ID');
    if (senderId) form.set('from', senderId);
    let ok = false;
    let detail = '';
    try {
      const response = await fetch(`https://${host}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await response.json().catch(() => null)) as {
        SMSMessageData?: { Recipients?: { status: string; statusCode: number }[] };
      } | null;
      const recipient = data?.SMSMessageData?.Recipients?.[0];
      // 100 = processed, 101 = sent, 102 = queued.
      ok = response.ok && !!recipient && [100, 101, 102].includes(recipient.statusCode);
      detail = recipient ? `${recipient.statusCode} ${recipient.status}` : `HTTP ${response.status}`;
    } catch (error) {
      detail = (error as Error).message;
    }
    if (!ok) {
      // Never log the message body: it may contain a login code.
      this.logger.error(`SMS to ${to.slice(0, -4)}**** failed: ${detail}`);
      throw new ServiceUnavailableException('We could not send the SMS. Please try again in a minute');
    }
  }

  private deliver(message: OutgoingMessage) {
    if (this.production) throw new ServiceUnavailableException('SMS is not set up on this server');
    this.outbox.push(message);
    if (this.outbox.length > 500) this.outbox.shift();
    if (this.config.get('NODE_ENV') !== 'test') {
      this.logger.log(`[${message.channel} to ${message.to}] ${message.subject ?? ''} ${message.body}`);
    }
  }
}

@Global()
@Module({ providers: [MessagingService], exports: [MessagingService] })
export class MessagingModule {}
