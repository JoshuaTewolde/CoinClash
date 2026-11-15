# 0018: Public escrow page

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Stakes are held by a custodial escrow (ADR 0013). "Secured by CoinClash" is a promise; players
had no way to check it.

## Decision

- `GET /api/escrow` (public, no auth, cached 15 s) returns:
  - `balance`: the escrow wallet's balance (`EscrowRail.balance()`; Breez `getInfo`).
  - `owed`: per match, the unpaid payouts and refunds once settling has started, otherwise
    the stakes already paid in. Summed over unfinished matches and matches with open payouts.
  - `liveMatches`, and the 10 most recent paid payouts and refunds (game, amount, time, **no
    names or ids**).
- `/escrow` (no account needed) shows Held vs Owed and "✓ Fully covered" when balance ≥ owed,
  refreshing every 20 s. Every "Secured by CoinClash" badge links to it.

## Consequences

- It's a self-reported number, not a cryptographic proof of reserves. It still makes the escrow's
  state visible at a glance, and a shortfall shows up immediately.
- The escrow balance becomes public. That's intended for test sats; revisit before mainnet.
