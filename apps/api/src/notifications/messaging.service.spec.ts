import { ConfigService } from '@nestjs/config';
import { MessagingService } from './messaging.service.js';

const service = (env: Record<string, string>) => new MessagingService(new ConfigService(env));

describe('MessagingService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps messages in the outbox outside production when no provider is set', async () => {
    const messaging = service({ NODE_ENV: 'test' });
    await messaging.sendSms('+254700000001', 'Your code is 123456');
    expect(messaging.lastMessageTo('+254700000001')?.body).toBe('Your code is 123456');
  });

  it('refuses to pretend in production', async () => {
    await expect(service({ NODE_ENV: 'production' }).sendSms('+254700000001', 'x')).rejects.toThrow('SMS is not set up');
  });

  it("sends through Africa's Talking", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ status: 'Success', statusCode: 101 }] } }), { status: 201 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const messaging = service({ NODE_ENV: 'production', AT_USERNAME: 'errandconnect', AT_API_KEY: 'key', AT_SENDER_ID: 'ERRANDCONN' });
    await messaging.sendSms('+254700000001', 'Your code is 123456');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.africastalking.com/version1/messaging');
    expect(init.headers.apiKey).toBe('key');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      username: 'errandconnect',
      to: '+254700000001',
      message: 'Your code is 123456',
      from: 'ERRANDCONN',
    });
    expect(messaging.outbox).toHaveLength(0);
  });

  it('reports a failed send', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ status: 'InvalidPhoneNumber', statusCode: 403 }] } })),
        ),
    );
    await expect(service({ AT_USERNAME: 'sandbox', AT_API_KEY: 'key' }).sendSms('+254700000001', 'x')).rejects.toThrow(
      'could not send the SMS',
    );
  });
});
