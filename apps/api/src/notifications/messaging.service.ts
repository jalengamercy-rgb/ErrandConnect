import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OutgoingMessage {
  channel: 'SMS' | 'EMAIL';
  to: string;
  subject?: string;
  body: string;
  sentAt: Date;
}

/**
 * Sends SMS and email. Until real providers are connected (Africa's Talking
 * for SMS, an email service), messages are written to the log and kept in
 * `outbox` so developers and tests can read OTP codes.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  readonly outbox: OutgoingMessage[] = [];

  constructor(private readonly config: ConfigService) {}

  async sendSms(to: string, body: string): Promise<void> {
    this.deliver({ channel: 'SMS', to, body, sentAt: new Date() });
  }

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.deliver({ channel: 'EMAIL', to, subject, body, sentAt: new Date() });
  }

  /** Latest message sent to an address (dev/test helper). */
  lastMessageTo(to: string): OutgoingMessage | undefined {
    return this.outbox.findLast((m) => m.to === to);
  }

  private deliver(message: OutgoingMessage) {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new Error('No SMS/email provider configured');
    }
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
