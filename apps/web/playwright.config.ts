/**
 * Playwright E2E: phone viewport, NETWORK=mock (shared in-memory Spark network on the server),
 * in-memory DB. Two browser contexts = two players (spec §11).
 */
import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 8788;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Run the server directly (no root .env), so E2E never touches Atlas or Breez.
      command: 'pnpm --filter @coinclash/server exec tsx src/index.ts',
      url: `http://localhost:${SERVER_PORT}/health`,
      env: {
        NETWORK: 'mock',
        MONGODB_URI: 'memory',
        PORT: String(SERVER_PORT),
        PUBLIC_WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { COINCLASH_SERVER: `http://localhost:${SERVER_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
