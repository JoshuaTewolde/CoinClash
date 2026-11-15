# Build prompt — friends-only turn-based games for sats (Breez SDK, Hack The Nest 2026)

> Paste everything below into Claude Code as your first message in an empty repo.
> Sections marked **[CHANGE ME]** are choices you may want to adjust first.

---

## Amendments (read first)

These override the sections below. Rationale lives in `docs/decisions/`.

- **2026-11-14, [ADR 0002](decisions/0002-htlc-oracle-escrow.md):** §6 is replaced. There is **one payment mode, Secure**, implemented as **HTLC "oracle" escrow**. Players cross-lock Spark HTLCs to each other, and the server only releases the winner's secret code. The server never holds match funds. **Trusted Friend mode, server-held escrow, external-wallet deposits and the debts system are removed.** This affects §1, §5, §6, §7, §8, §11 and §12 as described in the ADR.
- **2026-11-14, [ADR 0003](decisions/0003-chrome-only-passkeys.md):** Chrome only for now, two-button passkey flow (Create account / Sign in).
- **2026-11-14, [ADR 0004](decisions/0004-hosting-and-database.md):** domain `coinclash.vip`, MongoDB Atlas.
- **2026-11-14, [ADR 0006](decisions/0006-game-plugin-interface.md):** `GamePlugin` gains `maxMatchSeconds` and a timeout/cap result rule (needed for HTLC deadlines).

---

## 0. Context and how to work

You are building a hackathon project for **Hack The Nest 2026** (Eastern Michigan University), entered in the **Future of Money** track for the **Breez "Multiplayer Game Prizes" bounty**: *players win sats each round and send them to each other in one tap*, built on the **Breez SDK (Nodeless / Spark implementation)**. Hacking ends **Sunday Nov 15, 12:00 PM Eastern**. Ship a working core early and improve it; never leave `main` broken.

Working rules:
- **Plan first.** Before writing code, read this whole prompt and reply with a short implementation plan and the repo layout. Then build phase by phase (section 12).
- **Verify Breez APIs against the current docs** (https://sdk-doc-spark.breez.technology/ and the `@breeztech/breez-sdk-spark` package). Do not invent method names. If something here conflicts with the docs, the docs win: tell me what changed.
- **Commit early and often** with Conventional Commit messages (`feat:`, `fix:`, `test:`, `ci:`…), one logical change per commit, each with passing tests. Push to the GitHub remote when I've set it up.
- **Never commit secrets.** No real seeds, mnemonics, API keys, or `.env` files in git, ever.
- Create a `CLAUDE.md` early that records the conventions, commands and architecture decisions, so later sessions (and teammates' agents) stay consistent.
- Do **not** write the Breez write-up answers or the final submission README yet. I'll ask at the end.

## 1. Product

A **phone-first web app (installable PWA)** where friends challenge each other to quick **turn-based** games for sats. GamePigeon-style: send a link to a friend, agree on a stake, both pay into escrow, play, and the winner gets paid automatically.

- **Friends only**, via invite links (no public matchmaking, no spectators, no chat in v1).
- Sats are the main unit; show dollars smaller, in parentheses: `5,000 sats (≈ $4.87)`, using Breez's fiat rates. On regtest, label amounts as **test sats** and hide the dollar value.
- Supports one-tap **rematch** (same game, same stake).
- **Every match is staked. There is no free play.** The point is to get people using Breez payments, even with test sats.
- **Welcome bonus (regtest only):** when a new user finishes onboarding, the server's house wallet automatically sends them **10,000 test sats** (amount in env, once per wallet identity, rate-limited) so a friend can go from invite link to first match in under a minute. Also link the regtest faucet in the Wallet screen.

## 2. Tech stack

- **Monorepo** with pnpm workspaces, TypeScript everywhere, strict mode.
  ```
  apps/web            React + Vite PWA (vite-plugin-pwa)
  apps/server         Node + TypeScript, Express + Socket.IO
  packages/shared     protocol types, zod schemas, money/format utils
  packages/game-sdk   the game plug-in interface + test helpers
  packages/games/*    one package per game (tictactoe, connect4, rps, trivia, pool)
  ```
- **MongoDB Atlas** (via the official driver or Mongoose) for users, matches, ledger.
- **Breez SDK (Spark)**: the browser build (`@breeztech/breez-sdk-spark/web`) for each player's own wallet, and the Node build for the server's **escrow wallet**.
- Validation with **zod** on every socket message and HTTP body.
- Hosting target: **Vultr** (Docker image for the server; static build for the web app), on a domain with HTTPS (needed for passkeys and PWA install).

## 3. Game plug-in system (core design)

The base app handles accounts, invites, stakes, escrow, timers and payouts. **Games are plug-ins that only know about game rules.** The goal is that someone can write a new game package without touching payment code.

Define in `packages/game-sdk` something like:

```ts
interface GamePlugin<State, Move, PublicView> {
  id: string;                       // "connect4"
  name: string;                     // "Connect 4"
  minPlayers: 2; maxPlayers: 2;     // v1 is 2-player only (keep the type ready for more)
  turnModel: "alternating" | "simultaneous";
  defaultTurnSeconds: number;
  init(ctx: { players: PlayerId[]; seed: string; options?: unknown }): State;
  validateMove(state: State, player: PlayerId, move: unknown): Move | InvalidMove; // must parse untrusted input
  applyMove(state: State, player: PlayerId, move: Move): State;                  // pure, deterministic
  getResult(state: State): { status: "ongoing" } | { status: "win"; winner: PlayerId } | { status: "draw" };
  viewFor(state: State, player: PlayerId | null): PublicView;                    // hide secret info
  onTimeout?(state: State, player: PlayerId): State;                            // default: that player forfeits
}
```

Rules:
- **The server is the only source of truth.** Clients send *intents* (moves); the server validates, applies and broadcasts `viewFor(...)`. Never trust a client-reported result.
- Engines are **pure and deterministic** (seeded randomness only), so they can be unit-tested and replayed.
- Each game package ships its **engine (shared)** + **React board component (web)** + **tests**.
- Plug-ins are in-repo and trusted for now. Write `docs/writing-a-game.md` explaining how to add one, and note sandboxing third-party plug-ins as future work.

## 4. Games (build in this order)

1. **Tic-tac-toe.** Standard 3×3. Draw on full board. This is the first end-to-end test of the whole money flow.
2. **Connect 4.** 7×6, gravity drop, four in a row in any direction. Draw on full board.
3. **Rock-paper-scissors.** `simultaneous` turn model: the server holds each player's pick hidden until both are in, then reveals. Best of 3 by default (creator can choose 3 or 5). Tied rounds are replayed within the match; a match itself never ends in a draw.
4. **Trivia.** Both players get the **same** questions in the same order (server-picked with the match seed), 10 questions, server-side timer per question (15 s), points for correct answers with a small speed bonus measured on the **server**. Tie → sudden-death questions (max 3), then draw. Source questions from Open Trivia DB via the server with a cached local JSON fallback bank, so it works offline.
5. **Pool (stretch goal).** Simplified 8-ball. Turn-based: the client sends only `{angle, power}` (maybe spin later). The **server runs a deterministic physics simulation** (e.g. planck.js or a small custom circle-collision engine with a fixed timestep) and returns the result plus keyframes; the client animates the replay. Simplified rules: break, solids/stripes assigned on first legal pot, foul = scratch or no contact (ball in hand can be simplified to "opponent's turn"), sink the 8 last to win, sink it early = loss. Only start this after phases 1–4 are solid.

Chess and reaction-speed games are out of scope (chess may come later as a plug-in).

## 5. Stakes and negotiation

> **Amended:** there is no payment-mode choice in negotiation (ADR 0002).

- The challenger picks a game, a **payment mode** (section 6: Secure escrow by default, or Trusted Friend), and proposes a stake from **100 to 100,000 sats** (min/max configurable in env). The payment mode is part of the proposal; the opponent must agree to it too and can counter it.
- The opponent can **Accept**, **Counter** with a different amount, or tap **"Take the lower"**, which accepts the lower of the last two proposals. Counters can go back and forth until someone accepts. Show the full proposal history in the challenge card.
- Before paying, show each player exactly: stake, pot, estimated network fee (taken from the pot on payout), and the payout to the winner. No house fee.

## 6. Payment modes

> **Amended:** superseded by [ADR 0002](decisions/0002-htlc-oracle-escrow.md). The text below is kept for history.

Two modes, chosen per match during negotiation. **Secure is the default.** Both must run through the same `PaymentRail` abstraction and the same match state machine, with mode-specific branches.

### 6a. Trusted Friend mode (direct, no middleman)
Players pay each other directly, with no escrow. Be honest in the UI that this relies on trust: show "Trusted: the loser pays you directly when the game ends" on the challenge card.
- **Start-of-match balance check:** each client reads its own Breez wallet balance and reports `balance ≥ stake` in a message signed by the wallet. The match starts only when both have reported. (This proves funds existed at the start only. The server cannot see non-custodial balances, and the UI must not claim more.)
- **End of match:** the loser's client **automatically** pays the stake to the winner (winner's Spark address on regtest, Lightning address or auto-generated invoice on mainnet) with no confirm tap, and the winner's client confirms receipt to the server. Draws: nothing moves.
- **If the payment doesn't complete** (loser closed the app, insufficient funds, error): record a **debt** (`debts` collection: creditor, debtor, amount, match id, status). Retry automatically whenever the debtor's app reconnects. The debtor cannot start or accept new matches until debts are settled, and both players see the open debt.
- **Reliability record:** show each friend's payment record on their profile/head-to-head ("Paid 12 of 12").
- Tests: auto-pay on loss, loser disconnects before paying → debt → retry on reconnect → settled, blocked from new matches while in debt, double-payment prevention, draw moves nothing.

### 6b. Secure mode (server-held escrow)

Model each match as an explicit **state machine**, persisted in MongoDB, with every transition logged:

```
PROPOSED → NEGOTIATING → AGREED → AWAITING_DEPOSITS
AWAITING_DEPOSITS → (both paid) IN_PROGRESS
AWAITING_DEPOSITS → (timeout 3 min) REFUNDING → REFUNDED     // refund whoever paid
IN_PROGRESS → (win | opponent forfeits) PAYING_OUT → PAID
IN_PROGRESS → (draw) REMATCH_OFFERED
REMATCH_OFFERED → (both tap rematch within 30 s) IN_PROGRESS  // same pot, new game
REMATCH_OFFERED → (otherwise) REFUNDING → REFUNDED
any → FAILED (needs attention; never silently lose money)
```

Requirements:
- **The game starts only when the server has confirmed both deposits.** Paying the deposit *is* the balance check.
- Each deposit must be attributable to one player in one match: use a **unique payment request per deposit** (Lightning invoice on mainnet; on regtest use whatever per-payment request the Spark SDK supports, so check the docs). Detect payment via SDK events, plus polling as a backup.
- **Payouts and refunds are idempotent.** Keep a `ledger` collection (deposit / payout / refund entries with SDK payment ids) and never pay the same entry twice, even after a crash or retry.
- **On server start, reconcile**: scan matches not in a final state; refund or resume as appropriate.
- **Timers**: per-turn timer (plug-in default, ~60 s); disconnect grace period 60 s, then the disconnected player forfeits. Opponent sees a countdown.
- Payout destination: the winner's in-app Breez wallet (server pays a request generated automatically by the winner's client), or a Lightning address saved in their profile (mainnet).
- Also let a player pay a deposit from an **external wallet**: show the request as a QR code **and** a "Open in wallet" button using a `lightning:` link (for paying on the same phone) **and** a copy button.

### Network modes
- `NETWORK=mock`: a fake in-memory payment rail (instant, scriptable) **for automated tests, CI and offline UI development only. Never exposed to players.** It must be able to simulate failures on demand (duplicate payment events, deposits that never arrive, failed payouts, slow confirmations) so the escrow and trusted-mode edge cases can be tested deterministically. **Build this first** and keep it working.
- `NETWORK=regtest` (default for development): Breez/Spark regtest, free test funds from the faucet. Breez's docs note regtest has no developed Lightning network, so wallet-to-wallet transfers here should use Spark-native payments.
- `NETWORK=mainnet`: real Lightning, intended for tiny stakes in the final demo. Show a persistent "REAL MONEY" badge.

Put all money movement behind one interface (e.g. `PaymentRail` with `createDepositRequest`, `onPaymentReceived`, `pay`, `getBalance`) with `mock`, `regtest` and `mainnet` implementations, so game and escrow code never touch the SDK directly.

## 7. Accounts and wallets (Breez passkey login)

- Onboarding: choose a nickname → create a passkey → the Breez SDK derives the wallet from the passkey (WebAuthn PRF; no seed phrase shown). Returning on a new device: sign in with the same passkey to restore the wallet and identity. Follow Breez's passkey onboarding guide and UX guidelines.
- **App identity = the wallet's public identity.** Authenticate to our server by having the client **sign a server-issued nonce with the wallet** (use the SDK's message-signing feature if available; verify server-side), then issue a short-lived session token. No passwords. If signing isn't available in the SDK, propose an alternative before building.
- Store per user: nickname, wallet identity, optional Lightning address, match history, head-to-head records with friends.
- **Losing the passkey means losing the wallet** (passkeys normally sync via Google Password Manager / iCloud Keychain). Show a clear notice, and if the SDK allows exporting a backup, offer it in Settings.
- The Breez API key is needed in the browser build: load it from env at build time and document the exposure; the **escrow wallet's seed and the server API key live only on the server**.

## 8. Screens (phone-first)

1. **Home**: balance (sats, $ small), "New challenge", recent matches, friends/head-to-head records.
2. **New challenge**: pick game → set stake → choose payment mode (Secure / Trusted Friend, with a one-line explanation of each) → share invite via the Web Share API (fallback: copy link).
3. **Challenge card** (invite link landing): who challenged you, game, proposal history, Accept / Counter / Take the lower.
4. **Deposit** (now **"Lock your stake"**, in-app wallet only, per ADR 0002): pay from in-app wallet (one tap) or external wallet (QR / open in wallet / copy). Live "waiting for opponent's deposit" status with the timeout countdown.
5. **Game screen**: board, whose turn, turn timer, pot amount always visible.
6. **Result**: winner, payout confirmation with payment status, Rematch button, share result.
7. **Wallet**: balance, receive (faucet link on regtest), send, transaction history.
8. **Settings**: Lightning address, network badge, backup notice.

## 9. Visual design **[CHANGE ME — pick one direction]**

Must **not** look AI-generated. Avoid: purple/blue gradients, glassmorphism cards, Inter/system-font-only UI, generic emoji icons, "crypto neon" aesthetics, everything centered in rounded cards. If the `frontend-design` skill is available, use it.

Chosen direction: **Sticker Arcade**: thick black outlines (3px), flat saturated fills, hard offset drop shadows (no blur), chunky buttons that physically "press" (translate + shadow shrink on tap), big playful display font (e.g. "Bricolage Grotesque" or "Rubik Mono One" for headings) with a clean readable body font (e.g. "Space Grotesk"), off-white background (#FFF8EC), palette of tomato red, sunflower yellow, teal, and ink black; Bitcoin orange used *only* for money amounts. Game pieces feel like physical toys. Micro-animations: piece drops with bounce, coin-burst on payout.

(Alternates: **Notebook Game Night**: off-white paper, hand-drawn pencil boards, marker-colored pieces, slightly rotated sticky-note cards. **Felt & Brass**: dark green felt texture, cream type, brass accents, tactile like a real game table, which fits pool.)

Build a small design system first (tokens, Button, Card, AmountLabel, Board frame, Timer) and use it everywhere. Respect `prefers-reduced-motion`. Large touch targets (≥ 44px), works at 360px width.

## 10. PWA

vite-plugin-pwa with manifest (name, short_name, icons 192/512 + maskable, theme color, `display: standalone`), offline app shell, custom install prompt button. **Do not cache** API or socket traffic. Target Chrome/Edge (desktop + Android) and iOS "Add to Home Screen".

## 11. Quality: tests, CI, secrets

- **Unit tests (Vitest)** for every game engine: legal/illegal moves, every win line, draws, timeouts, and that `viewFor` never leaks hidden info (RPS picks, trivia answers before reveal). Add **property-based tests (fast-check)**: random legal move sequences never crash, results are consistent, and replaying a move log reproduces the same state.
- **Escrow state machine tests** with the mock rail and fake timers: every transition, deposit timeout refunds, disconnect forfeit, draw → rematch / refund, crash-and-reconcile, idempotent payout (double-delivered events pay once).
- **Integration tests**: two simulated Socket.IO clients play full matches against the real server (mock rail + in-memory MongoDB via `mongodb-memory-server`).
- **E2E (Playwright)**, mobile viewport, mock rail: two browser contexts complete challenge → negotiate → deposit → play → payout for tic-tac-toe and Connect 4.
- Coverage thresholds: ≥ 90% for game engines and escrow, reasonable elsewhere.
- **GitHub Actions**:
  - `ci.yml` on every push/PR: install (pnpm cache), lint (ESLint), format check (Prettier), typecheck, unit + integration tests with coverage, build, Playwright E2E, **gitleaks** secret scan.
  - `regtest.yml` on manual dispatch (and optionally nightly): runs a real regtest end-to-end payment test using **GitHub Actions secrets** (`BREEZ_API_KEY`, `REGTEST_ESCROW_MNEMONIC`, etc.).
  - `deploy.yml` on push to `main` after CI passes: build Docker image, deploy to Vultr over SSH using secrets (`VULTR_HOST`, `VULTR_SSH_KEY`, …). Leave it disabled/conditional until I add the secrets.
- Provide `.env.example` documenting every variable; real values go in local `.env` (gitignored) and GitHub secrets. List the exact secret names I need to create.
- Add a pre-commit hook (lint-staged) for lint + format.

## 12. Build phases (each ends green, committed)

1. **Skeleton**: monorepo, tooling, CI, `CLAUDE.md`, `.env.example`, design tokens, MIT `LICENSE`.
2. **Game SDK + Tic-tac-toe engine** with full tests.
3. **Server core**: Socket.IO rooms, invite links, negotiation, match state machine, timers, **mock rail**, MongoDB persistence, reconciliation. Full tests.
4. **Web app**: onboarding (mock auth first), home, challenge, deposit, tic-tac-toe screen, result, rematch. Playwright E2E.
5. **Breez integration (regtest)**: passkey onboarding, browser wallet, server escrow/house wallet, welcome bonus, real deposits/payouts/refunds, signed-nonce auth, then **Trusted Friend mode** (balance attestation, auto-pay, debts). Manual test checklist in `docs/testing-regtest.md`.
6. **Connect 4**, then **RPS**, then **Trivia**: each with engine tests, board UI, E2E.
7. **PWA** install + polish + deploy to Vultr on my domain.
8. **Pool** (stretch).
9. **Mainnet toggle** for tiny-stake demo (only when I ask).

After each phase, give me a 3–5 line status: what works, what's next, anything I need to do (API keys, secrets, domain).

## 13. Out of scope for now (mention as future work later, don't build)

Public matchmaking, spectators, chat/lobby, 3+ player games (poker), chess, reaction-speed games, sandboxed third-party plug-ins, custom Lightning address domain, stablecoin stakes, hold-invoice (non-custodial) escrow.