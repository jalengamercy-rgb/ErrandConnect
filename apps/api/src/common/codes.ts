import { randomCode, randomDigits } from './crypto.js';

/**
 * Generates a code and retries until `isTaken` says it's free.
 * Collisions are very rare, so this almost always succeeds first time.
 */
export async function uniqueCode(generate: () => string, isTaken: (code: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generate();
    if (!(await isTaken(code))) return code;
  }
  throw new Error('Could not generate a unique code');
}

export const newReferralCode = () => randomCode(8);
export const newCustomerCode = () => `EC-C-${randomDigits(7)}`;
export const newRunnerCode = () => `EC-R-${randomDigits(7)}`;
