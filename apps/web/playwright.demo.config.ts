/**
 * Demo video recording (docs/demo-script.md): `pnpm --filter @coinclash/web exec playwright test
 * -c playwright.demo.config.ts`. Same mock servers as the E2E suite; not run in CI.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './demo',
  timeout: 600_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: base.use?.baseURL,
    launchOptions: { slowMo: 120 },
    actionTimeout: 15_000,
  },
});
