/**
 * Real-network E2E: Breez SDK on Spark regtest, passkeys via Chrome's virtual WebAuthn
 * authenticator (PRF enabled).
 *
 *   pnpm --filter @coinclash/web e2e:regtest                          # local stack, in-memory DB
 *   PROD_URL=https://coinclash.vip pnpm --filter @coinclash/web e2e:regtest   # the live site
 *
 * Local mode needs the root .env (BREEZ_API_KEY, VITE_BREEZ_API_KEY, HOUSE_MNEMONIC with a funded
 * house wallet). HOST_RESOLVER_RULES (Chrome --host-resolver-rules) works around networks whose
 * DNS can't resolve a Spark operator, e.g. `MAP 2.spark.flashnet.xyz 104.18.22.148`.
 */
import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 8790;
const WEB_PORT = 5176;
const PROD_URL = process.env.PROD_URL;
const resolverRules = process.env.HOST_RESOLVER_RULES;

export default defineConfig({
  testDir: './e2e-regtest',
  timeout: 10 * 60_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: PROD_URL ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: resolverRules ? { args: [`--host-resolver-rules=${resolverRules}`] } : {},
  },
  webServer: PROD_URL
    ? undefined
    : [
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
          env: {
            COINCLASH_SERVER: `http://localhost:${SERVER_PORT}`,
            VITE_PASSKEY_RP_ID: 'localhost',
          },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
