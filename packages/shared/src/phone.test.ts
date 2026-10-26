import { describe, expect, it } from 'vitest';
import { normalizeKenyanPhone } from './phone';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['0112345678', '+254112345678'],
    ['712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['0712-345-678', '+254712345678'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(['', '0812345678', '071234567', '07123456789', '+255712345678', 'abc'])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});
