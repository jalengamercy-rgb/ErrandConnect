import { validateEnv } from './env.js';

const strong = (c: string) => c.repeat(40);
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: strong('a'),
  OTP_SECRET: strong('b'),
  MPESA_CALLBACK_SECRET: strong('c'),
  DATA_ENCRYPTION_KEY: strong('d'),
  CORS_ORIGINS: 'https://admin.errandconnect.co.ke',
  MPESA_MODE: 'daraja',
  AT_USERNAME: 'errandconnect',
  AT_API_KEY: 'key',
};

describe('validateEnv', () => {
  it('accepts development defaults', () => {
    expect(() => validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://x', JWT_SECRET: 'change-me' })).not.toThrow();
  });

  it('accepts a complete production setup', () => {
    expect(() => validateEnv(production)).not.toThrow();
  });

  it('refuses weak, example or repeated secrets and unsafe settings in production', () => {
    expect(() => validateEnv({ ...production, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET must be at least 32/);
    expect(() => validateEnv({ ...production, OTP_SECRET: 'change-me-' + strong('x') })).toThrow(/example value/);
    expect(() => validateEnv({ ...production, OTP_SECRET: production.JWT_SECRET })).toThrow(/different value for each secret/);
    expect(() => validateEnv({ ...production, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
    expect(() => validateEnv({ ...production, MPESA_MODE: 'fake' })).toThrow(/MPESA_MODE=fake/);
    expect(() => validateEnv({ ...production, STAFF_MFA_REQUIRED: 'false' })).toThrow(/STAFF_MFA_REQUIRED/);
    expect(() => validateEnv({ ...production, AT_API_KEY: '' })).toThrow(/Africa's Talking/);
  });
});
