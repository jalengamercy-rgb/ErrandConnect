/**
 * Checks settings when the API starts. In production it refuses to start with
 * missing or placeholder secrets rather than run insecurely.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const production = config.NODE_ENV === 'production';
  const errors: string[] = [];
  const value = (key: string) => (typeof config[key] === 'string' ? (config[key] as string).trim() : '');

  if (!value('DATABASE_URL')) errors.push('DATABASE_URL is required');
  if (!value('JWT_SECRET')) errors.push('JWT_SECRET is required');

  if (production) {
    const secrets = ['JWT_SECRET', 'OTP_SECRET', 'MPESA_CALLBACK_SECRET', 'DATA_ENCRYPTION_KEY'];
    for (const key of secrets) {
      const secret = value(key);
      if (secret.length < 32) errors.push(`${key} must be at least 32 random characters in production (openssl rand -base64 48)`);
      else if (/change-me/i.test(secret)) errors.push(`${key} still has the example value`);
    }
    if (new Set(secrets.map(value)).size !== secrets.length) errors.push('Use a different value for each secret');
    if (!value('CORS_ORIGINS')) errors.push('CORS_ORIGINS must list the admin panel (and web app) origins in production');
    if (value('STAFF_MFA_REQUIRED') === 'false') errors.push('STAFF_MFA_REQUIRED cannot be turned off in production');
    if ((value('MPESA_MODE') || 'daraja') === 'fake') errors.push('MPESA_MODE=fake is not allowed in production');
    if (!value('AT_USERNAME') || !value('AT_API_KEY'))
      errors.push("AT_USERNAME and AT_API_KEY (Africa's Talking) are required to send sign-up codes by SMS");
  }
  if (errors.length) throw new Error(`Configuration problems:\n- ${errors.join('\n- ')}`);
  return config;
}
