# 0006: Game plug-in interface details

- **Date:** 2026-11-14
- **Status:** Accepted. Refines spec §3.

## Context

Spec §3 sketches `GamePlugin`. Building it, plus the HTLC escrow from ADR 0002, needed a few
additions and some decisions about where cross-cutting rules (forfeits, timeouts, replay) live.

## Decision

`packages/game-sdk` exports:

1. **`GamePlugin<State, Move, View>`** (`src/types.ts`), the spec's shape plus:
   - **`maxMatchSeconds`** (required): a hard cap on match length. HTLC expiries are computed from
     it (ADR 0002), so it must be a real upper bound. When it's hit, **`onMatchCap(state)`**
     decides the result (default: draw).
   - **`activePlayers(state)`** (required): who the server is waiting on. It drives turn timers
     and "your turn" UI, for both alternating and simultaneous games.
   - **`onTimeout`** may return a new state or `'forfeit'` (also the default when omitted).
   - **`legalMoves`** (optional): enables the fuzz harness and future bots.
   - **`parseOptions`** (optional): validates creator options such as RPS best-of-3/5.
   - `GameResult` carries a **`reason`** (`normal | forfeit | timeout | match-cap`) for logs and the
     result screen.
2. **Session helpers** (`src/session.ts`), the only way the server touches a game:
   `startSession`, `submitMove`, `timeoutPlayer`, `forfeit`, `applyMatchCap`, `sessionResult`,
   `waitingOn`, `replaySession`, `createRegistry`.
   - A `GameSession` is plain data: init context, plug-in state, an optional **override result**
     and an **event log** (`move | timeout | forfeit | match-cap`).
   - Forfeits, timeouts and caps live **outside** the plug-in as overrides, so every game gets
     them for free and plug-in state stays about the board only.
   - `submitMove` is the single gate for untrusted input. It checks that the game is live, the sender
     is a player, it's their turn, and the plug-in accepts the move. It **catches exceptions** from
     buggy plug-ins so they can't crash the server.
   - The event log stores the **parsed** move. Persisting `(ctx, events)` is enough to rebuild a
     match exactly. This is our audit trail for "the oracle released the right code".
3. **Seeded RNG** (`src/rng.ts`): cyrb128 → sfc32, `createRng(seed)` and `deriveSeed(seed, ...labels)`.
   It's not cryptographic. HTLC preimages use `crypto.randomBytes`.
4. **Test harness** (`@coinclash/game-sdk/testing`):
   - `checkPluginContract(plugin)`: fast-check properties every game must pass. These cover
     deterministic `init`; random legal play plus timeouts never crashing and always terminating;
     replay reproducing the same state and result; finished games rejecting moves; JSON-safe
     `viewFor`; and junk input never throwing.
   - `randomPlaythrough` deep-freezes state before every move to catch mutation.

**Tic-tac-toe** (`packages/games/tictactoe`) is the reference implementation. The seed picks who
plays X (and moves first), so the first-move advantage is fair across rematches. The turn is 60 s,
and `maxMatchSeconds` is 600 (9 × 60 s plus slack).

## Alternatives considered

- **Forfeit inside each plug-in's state:** every game would duplicate it and could get it wrong.
- **Classes instead of plain objects/data:** plain data is trivially persisted to Mongo,
  sent over sockets and deep-compared in tests.
- **Storing the raw client move in the log:** the parsed move is canonical (extra keys stripped)
  and still re-validates on replay.

## Consequences / trade-offs

- Every plug-in must declare an honest `maxMatchSeconds`. Longer caps mean longer worst-case lockups
  for HTLC stakes (ADR 0002, trade-off 2).
- Game packages export `./engine` now, and `./board` arrives with the web UI (Phase 4).
- `testing.ts` imports `node:util` and fast-check: test-only, never import it from app code.
