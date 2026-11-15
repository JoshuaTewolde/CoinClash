# 0011: Web app architecture (Phase 4)

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Phase 4 builds the phone-first web app on top of the server core (ADR 0007): onboarding (mock
auth first), Home, New challenge, Challenge card, Lock your stake, the tic-tac-toe screen, Result
and rematch, plus a Playwright E2E with two players. Breez arrives in Phase 5. The money flow is
HTLC "oracle" escrow (ADR 0002), so the browser has real work to do: lock, watch, attest and claim.

## Decisions

1. **One store, no state library.** `src/lib/store.ts` is a small class (session, wallet, socket,
   match cache, toasts), read by React through `useSyncExternalStore`. The server stays the source
   of truth: the store caches the latest `MatchView` per match and sends intents. Why: a handful
   of fields; a library would add weight without solving anything we have.
2. **One route per match** (`/m/:id`). The screen shown (invite sent, challenge card, lock,
   game, result, ended) follows `view.status`. So a reload, a deep link or a socket update always
   lands on the right step, and there's no client-side flow state to get out of sync.
3. **`MatchAgent` hides the escrow mechanics** (`src/match/agent.ts`). The player taps "Lock"
   once. The agent then sends the HTLC, polls for the opponent's lock to them (checking the
   amount, hash and expiry), signs "lock seen", and claims and signs "claimed" when a winning code
   arrives. Every step is idempotent: in-flight guards, a per-match "already locked" flag in
   `localStorage`, and a fallback that confirms a claim that already happened before a reload.
   It depends only on the `WalletRail` interface, so Phase 5 swaps in the Breez wallet unchanged.
4. **Mock wallet over HTTP for E2E** (`/api/mock-wallet/*`, server `src/mockWallet.ts`). Two
   browsers need one shared fake Spark network, so in `NETWORK=mock` the server hosts the
   `MockNetwork` and the browser's `HttpMockWallet` calls it. New mock wallets start with
   `WELCOME_BONUS_SATS`, standing in for the regtest welcome bonus. The routes are **mounted only
   when `NETWORK=mock`** (a test asserts they 404 on regtest). Identity is a random `mock-…` id in
   `localStorage` behind the same `IdentityProvider` interface (register / signIn / restore) that
   the passkey provider will implement, so onboarding keeps its two-button shape (ADR 0003).
5. **Boards live in game packages** (`packages/games/<id>/src/Board.tsx`, export `./board`) and
   implement `BoardProps` from game-sdk, a type-only interface that keeps game-sdk React-free.
   The web registry (`src/games/registry.tsx`) adds the name, icon and tile color. Games the
   server doesn't list in `/api/config` show as "Coming soon".
6. **Same origin everywhere.** In dev, Vite proxies `/api` and `/socket.io` to the server. In
   prod, Caddy does (ADR 0004). No CORS, and passkeys get one rpId.
7. **E2E runs everything in memory.** Playwright starts the server directly, with
   `NETWORK=mock` and `MONGODB_URI=memory` (not via the root `.env`), so it never touches Atlas
   or Breez, plus Vite on a separate port. Phone viewport (Pixel 7), two browser contexts. CI has a separate
   `e2e` job that uploads the report on failure.

## Consequences / trade-offs

- **Polling instead of wallet events for "lock seen"** (every 1.5 s while a match awaits locks).
  It's simple and works on both mock and Breez. Breez events can shorten it in Phase 5.
- **"Already locked" is remembered per device.** Signing in on a second device mid-lock could
  show "Lock" again. The rail rejects a duplicate HTLC for the same hash, so no double spend, but
  the message would be confusing. That's acceptable for now.
- **The network fee shows as "≈ 0 sats"** on the challenge card until the Breez rail can call
  `prepareSendPayment` for a real estimate (Phase 5).
- **Wallet "Send"** and the regtest faucet link come with the Breez wallet in Phase 5. The mock
  wallet has an "Add 10,000 sats" button for testing.
