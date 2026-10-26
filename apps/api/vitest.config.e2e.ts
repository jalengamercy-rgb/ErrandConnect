import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Use the separate test database and secrets.
    env: parse(readFileSync('.env.test')),
    globalSetup: ['test/global-setup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
