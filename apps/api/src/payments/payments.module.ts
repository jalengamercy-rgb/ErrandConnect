import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from './ledger.service.js';
import { DarajaMpesaClient } from './mpesa/daraja.client.js';
import { FakeMpesaClient } from './mpesa/fake.client.js';
import { MpesaClient } from './mpesa/mpesa.client.js';
import { AdminFinanceController, MpesaCallbackController, PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { WalletsService } from './wallets.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

/**
 * MPESA_MODE=fake (default outside production) simulates M-Pesa;
 * MPESA_MODE=daraja talks to Safaricom using the MPESA_* settings.
 */
function createMpesaClient(config: ConfigService): MpesaClient {
  const env = config.get<string>('NODE_ENV');
  const mode = config.get<string>('MPESA_MODE') ?? (env === 'production' ? 'daraja' : 'fake');
  if (mode === 'fake') {
    if (env === 'production') throw new Error('MPESA_MODE=fake is not allowed in production');
    new Logger('Payments').warn('Using simulated M-Pesa (MPESA_MODE=fake). No real money moves.');
    // Tests send callbacks themselves; in development payments confirm after 3 seconds.
    return new FakeMpesaClient(env !== 'test');
  }
  return new DarajaMpesaClient({
    environment: config.get('MPESA_ENV') === 'production' ? 'production' : 'sandbox',
    consumerKey: config.getOrThrow('MPESA_CONSUMER_KEY'),
    consumerSecret: config.getOrThrow('MPESA_CONSUMER_SECRET'),
    shortcode: config.getOrThrow('MPESA_SHORTCODE'),
    passkey: config.getOrThrow('MPESA_PASSKEY'),
    callbackBaseUrl: config.getOrThrow('MPESA_CALLBACK_BASE_URL'),
    callbackSecret: config.getOrThrow('MPESA_CALLBACK_SECRET'),
    b2cShortcode: config.get('MPESA_B2C_SHORTCODE'),
    initiatorName: config.get('MPESA_INITIATOR_NAME'),
    securityCredential: config.get('MPESA_SECURITY_CREDENTIAL'),
  });
}

@Module({
  controllers: [MpesaCallbackController, PaymentsController, AdminFinanceController],
  providers: [
    LedgerService,
    PaymentsService,
    WithdrawalsService,
    WalletsService,
    { provide: MpesaClient, inject: [ConfigService], useFactory: createMpesaClient },
  ],
  exports: [PaymentsService, LedgerService, MpesaClient],
})
export class PaymentsModule {}
