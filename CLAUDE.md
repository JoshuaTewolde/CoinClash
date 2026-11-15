# CLAUDE.md: CoinClash

Friends-only, turn-based games for sats (Hack The Nest 2026, Breez "Multiplayer Game Prizes" bounty).
**`docs/SPEC.md` is the source of truth.** Read it at the start of every session. If code and spec
disagree, the spec wins unless a decision below says otherwise.

## Commands

| What                | Command                                                    |
| ------------------- | ---------------------------------------------------------- |
| Install             | `pnpm install` (pnpm 9, Node ≥ 22)                         |
| Dev (web + server)  | `pnpm dev` (web :5173, server :8787, reads root `.env`)    |
| Lint / format       | `pnpm lint`, `pnpm format` / `pnpm format:check`           |
| Typecheck           | `pnpm typecheck`                                           |
| Tests (all)         | `pnpm test` (`pnpm test:coverage` for coverage)            |
| One project's tests | `pnpm vitest run --project server` (shared/game-sdk/web/…) |
| Build               | `pnpm build`                                               |

Every commit must leave lint, format, typecheck, tests and build green. A pre-commit hook
(husky + lint-staged) lints and formats staged files.

## Layout

```
apps/web            React + Vite PWA (phone-first). Design tokens: src/design/tokens.css
apps/server         Express + Socket.IO; built with tsup (bundles @coinclash/* packages)
packages/shared     zod protocol schemas, Network type, money/format utils
packages/game-sdk   GamePlugin interface, seeded RNG, test helpers
packages/games/*    one package per game: src/engine.ts (export "./engine", server-safe)
                    + src/Board.tsx (export "./board", web only) + test/
docs/               SPEC.md, writing-a-game.md, testing-regtest.md
```

Workspace packages export **TypeScript source** (`"exports": "./src/index.ts"`). Vite and Vitest
consume it directly, and the server's tsup build bundles it. There are no per-package build steps.

## Conventions

- TypeScript strict everywhere (`noUncheckedIndexedAccess` on). Use `import type` for types.
- ESM only. Relative imports inside packages use the `.js` suffix; web app imports omit it.
- **zod** validates every socket message and HTTP body at the boundary.
- **Server is the only source of truth.** Clients send intents; the server validates and applies them, then broadcasts `viewFor()`.
- Game engines are pure and deterministic (seeded RNG only). There is no game code in payment logic and no payment code in games.
- All money movement goes through the `PaymentRail` interface (`mock` | `regtest` | `mainnet`).
  Game and escrow code never import the Breez SDK directly.
- `NETWORK=mock` is for tests, CI and offline UI dev only. It is **never** exposed to players.
- Conventional Commits (`feat:`, `fix:`, `test:`, `ci:`, `docs:`, `chore:`), one logical change
  per commit.
- UI: "Sticker Arcade" design system (spec §9). Use tokens from `tokens.css`, never raw colors.
  Bitcoin orange (`--cc-money`) is used **only** for money amounts. Touch targets ≥ 44px, layouts
  work at 360px wide, and respect `prefers-reduced-motion`.
- Amounts: sats are primary and dollars secondary; on regtest/mock show "test sats" and no dollars. Use
  `formatAmount` from `@coinclash/shared`.

## Breez SDK (Spark): verified API notes (@breeztech/breez-sdk-spark, v0.28.x)

Verify against https://sdk-doc-spark.breez.technology/ and `github.com/breez/spark-sdk`
(`docs/breez-sdk/snippets/wasm/*.ts`) before using anything new. Do not invent method names.

- Web: `await init()` first (WASM). Node: no init. Then `connect({ config, seed, storageDir })`, where
  `config = defaultConfig('regtest' | 'mainnet')` and `config.apiKey` is required.
- Passkeys: `PasskeyClient(apiKey, { providerOptions: { rpId, rpName } })` from
  `@breeztech/breez-sdk-spark/passkey-prf-provider`. Methods: `checkAvailability`, `register`,
  `signIn`, `connectWithPasskey`. Each returns `wallet.seed` for `connect`. **Wallets are bound to rpId.**
- Auth: `sdk.signMessage({ message, compact })` returns `{ pubkey, signature }`. The server verifies with
  `sdk.checkMessage({ message, pubkey, signature })`, which returns `{ isValid }`. Identity is `getInfo().identityPubkey`.
- Deposits: one single-use `sparkInvoice` per deposit (`receivePayment({ paymentMethod: { type:
'sparkInvoice', amount, description, expiryTime, senderPublicKey } })`). Match incoming payments by
  `payment.details.invoiceDetails.invoice`. Mainnet: `bolt11Invoice`, matched by `details.invoice`.
- Events: `addEventListener({ onEvent })`, using `paymentSucceeded | paymentPending | paymentFailed | synced`.
  Backup polling: `listPayments({ typeFilter: ['receive'], fromTimestamp })`, `getPayment({ paymentId })`.
- Send: `prepareSendPayment({ paymentRequest: { type: 'input', input }, amount })` gives the fee
  estimate. Then call `sendPayment({ prepareResponse })`.
- Fiat: `listFiatRates()`. Balance: `getInfo({ ensureSynced }).balanceSats`.
- TODO (Phase 5): confirm the exact Node.js import path for the server build.

## Secrets

Never commit secrets: no seeds, mnemonics, API keys or `.env` files. gitleaks runs in CI.
`.env.example` documents every variable. `VITE_*` values are **public** (baked into the bundle).
`ESCROW_MNEMONIC` and the server `BREEZ_API_KEY` live only on the server and in GitHub secrets.

GitHub Actions secrets (create when needed):
`BREEZ_API_KEY`, `REGTEST_ESCROW_MNEMONIC`, `REGTEST_PLAYER_A_MNEMONIC`, `REGTEST_PLAYER_B_MNEMONIC`
(regtest.yml); `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_KEY` plus repo variable `DEPLOY_ENABLED=true`
(deploy.yml).

## Decisions log

- 2026-11-14: Spec kept at `docs/SPEC.md`. Repo `JoshuaTewolde/CoinClash` (public). Follow all
  spec phases in order with full test gates.
- 2026-11-14: Vitest 2 workspace (`vitest.workspace.ts`) and root `vitest.config.ts` for coverage.
- 2026-11-14: One server wallet serves as both escrow and house wallet; the ledger separates entry kinds.
- 2026-11-14: Browser target is **Chrome only** for now (desktop + Android). Passkeys use the
  two-button flow (Register / Sign in).
- 2026-11-14: Production domain is **coinclash.vip** (passkey rpId `coinclash.vip`). Database is
  **MongoDB Atlas**; tests still use mongodb-memory-server.
- Future work (don't build): Spark HTLC payments (`htlcOptions`) could enable non-custodial escrow.
