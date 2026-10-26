import { base32Decode, base32Encode, newTotpSecret, totpCode, totpStep, totpUri, verifyTotp } from './totp.js';
import { decryptSecret, encryptSecret } from './crypto.js';

// RFC 6238 test secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpCode(RFC_SECRET, totpStep(59_000))).toBe('287082');
    expect(totpCode(RFC_SECRET, totpStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(RFC_SECRET, totpStep(2_000_000_000_000))).toBe('279037');
  });

  it('round-trips base32', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('accepts one step of clock drift but never the same code twice', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
  });

  it('builds an authenticator link', () => {
    expect(totpUri('ABC', '+254700000001')).toBe(
      'otpauth://totp/ErrandCONNECT%3A%2B254700000001?secret=ABC&issuer=ErrandCONNECT&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secret encryption', () => {
  it('round-trips and rejects the wrong key or tampering', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP', 'key-one');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored, 'key-one')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(stored, 'key-two')).toThrow();
    expect(() => decryptSecret(stored.slice(0, -2) + 'AA', 'key-one')).toThrow();
  });
});
