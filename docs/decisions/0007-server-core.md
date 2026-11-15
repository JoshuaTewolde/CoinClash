# 0007: Server core (matches, protocol, auth, persistence, timers)

- **Date:** 2026-11-14
- **Status:** Accepted. Implements spec §3, §5, §6 (as amended by ADR 0002) and §7 for Phase 3.

## Context

Phase 3 needs the server half of the HTLC oracle escrow. It must be correct under retries,
crashes and duplicate events, and fully testable without a real wallet or database.

## Decision

### Layers

```
socket/HTTP (app.ts)    zod-validated commands, auth, per-player views, presence
      │
MatchService            per-match mutex, signature checks, persistence, timers, notices
      │
machine.ts (pure)       applyCommand(doc, cmd, env) → { doc, notices }; nextDeadline(doc)
      │
game-sdk sessions       rules via plug-ins (ADR 0006)
```

- **The state machine is a pure function.** `env` injects time, plug-ins, config and secret
  generation. Every transition (`PROPOSED → NEGOTIATING → AWAITING_LOCKS → IN_PROGRESS → SETTLING
→ SETTLED`, plus `DECLINED`, `CANCELLED`, `EXPIRED`) is unit-tested without timers or I/O, and is
  appended to `doc.transitions` with a cause.
- **One `tick` command handles all deadlines:** the lock window, turn timer, match cap,
  disconnect grace and claim window. The service keeps **one timer per match**, set to
  `nextDeadline(doc)`. On boot, `reconcile()` ticks every unfinished match, which processes
  anything that expired while the server was down, and re-arms the timers.
- **Concurrency:** an in-process per-match promise queue serializes commands, and Mongo saves use
  **optimistic versioning** (`replaceOne({_id, version: v-1})`) as a second guard.
- **Signatures:** lock and claim confirmations must be signed by the **receiving wallet** over a
  versioned, domain-separated message that binds match id, payment hash and amount
  (`coinclash:v1:lock-seen:<match>:<hash>:<amount>`). The server rebuilds the expected message and
  rejects anything else. Login signs `coinclash:v1:login:<nonce>`.
- **Codes** (preimages) come from `crypto.randomBytes(32)`, are stored only in the match document,
  are **never** part of any view, and go out only through a private `match:code` event to the
  player they pay. They are re-sent on every reconnect until that player confirms the claim.
- **Presence:** a count of sockets per user. The first connect clears grace timers and re-sends
  codes. The last disconnect starts a 60 s grace period, after which the player forfeits. Presence
  changes are **ignored after `stop()`**, so a server shutdown (which disconnects every socket)
  can't forfeit live games. A test caught this bug.
- **Auth:** single-use nonce (5 min), wallet signature, HMAC-SHA256 session token (7 days,
  `SESSION_SECRET`). Player id = wallet identity pubkey.
- **Storage:** `MatchRepo` and `UserRepo` interfaces, with Mongo implementations (Atlas in prod,
  `mongodb-memory-server` in integration tests) and in-memory ones (unit tests and
  `MONGODB_URI=memory` for offline dev/E2E). Matches are one document each, with the event log and
  transitions embedded. That's small, atomic per match, and easy to audit.
- **`packages/rail`**: the `WalletRail` interface (identity, address, balance, fee estimate, sign,
  `lock`, `findIncomingLock`, `onIncomingLock`, `claim`) and `SignatureVerifier`. `./mock` is an
  in-memory Spark network with a fake clock, HTLC expiry and fault injection (dropped locks,
  duplicate events, failing claims, fees, delays). The Breez implementation comes in Phase 5.

### Protocol

Socket commands (`packages/shared/src/protocol.ts`): `match:create | join | subscribe | accept |
counter | takeLower | decline | lockSeen | move | resign | claimed | rematch`. Each replies with an
`Ack<MatchView>`. The server pushes `match:update` (per-player view) and `match:code`. HTTP:
`/health`, `/api/config`, `/api/auth/nonce`, `/api/auth/login`, `/api/me`, `/api/matches`, and
`/api/invites/:code` (a public preview with no ids or secrets).

## Alternatives considered

- **An event-sourced match log in its own collection:** more flexible, but more moving parts. One
  document per match with embedded events gives us replay and audit already.
- **Redis for timers or locks:** unnecessary with one server instance. If we scale out, move the
  nonce store and per-match locking to Mongo or Redis.
- **Trusting the client's game result:** never. The server applies every move itself (spec §3).

## Consequences / trade-offs

- **Single instance only** (in-memory nonces, timers and mutex). That's fine for the hackathon.
- A player who goes offline _while the server is down_ doesn't get a grace timer on reboot, but the
  turn timer still ends their turn.
- In simultaneous games, if several players time out on the same tick, the plug-in's `onTimeout`
  decides. The default forfeit would hit whoever is processed first. RPS (Phase 6) overrides
  `onTimeout`.
