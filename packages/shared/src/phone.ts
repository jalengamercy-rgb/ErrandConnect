/**
 * Converts a Kenyan mobile number to E.164 (+2547XXXXXXXX / +2541XXXXXXXX).
 * Accepts 0712345678, 712345678, 254712345678 and +254712345678, with spaces or dashes.
 * Returns null if it isn't a valid Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '').replace(/^\+/, '');
  const match = /^(?:254|0)?([17]\d{8})$/.exec(digits);
  return match ? `+254${match[1]}` : null;
}
