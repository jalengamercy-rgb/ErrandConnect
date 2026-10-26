import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

/**
 * Brings the test database up to date. This never deletes data: each test
 * creates its own users with random phone numbers, so leftover rows from
 * earlier runs don't matter.
 */
export default function setup() {
  const env = { ...process.env, ...parse(readFileSync('.env.test')) };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
}
