/**
 * Real-network E2E: Breez SDK on Spark regtest, passkeys via Chrome's virtual WebAuthn
 * authenticator (PRF enabled). Needs the root .env (BREEZ_API_KEY, VITE_BREEZ_API_KEY,
 * HOUSE_MNEMONIC with a funded house wallet). In-memory DB so it never touches Atlas.
 *
 *   pnpm --filter @coinclash/web e2e:regtest
 */
import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 8790;
const WEB_PORT = 5176;

export default defineConfig({
  testDir: './e2e-regtest',
  timeout: 10 * 60_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm --filter @coinclash/server exec tsx --env-file-if-exists=../../.env src/index.ts',
      url: `http://localhost:${SERVER_PORT}/health`,
      // Real env vars win over --env-file values.
      env: {
        NETWORK: 'regtest',
        MONGODB_URI: 'memory',
        PORT: String(SERVER_PORT),
        PUBLIC_WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        BREEZ_STORAGE_DIR: './.data/breez-e2e',
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { COINCLASH_SERVER: `http://localhost:${SERVER_PORT}`, VITE_PASSKEY_RP_ID: 'localhost' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
