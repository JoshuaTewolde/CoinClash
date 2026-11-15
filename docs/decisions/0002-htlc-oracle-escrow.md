# 0002: Secure mode = HTLC "oracle" escrow; no custody, no Trusted mode

- **Date:** 2026-11-14
- **Status:** Accepted. **Supersedes spec §6 (6a Trusted Friend mode and 6b server-held escrow).**

## Context

The original spec had two payment modes:

- **Secure:** both players pay the server, the server holds the pot and pays the winner (custodial
  escrow).
- **Trusted Friend:** the loser's app pays the winner directly, with a debts system when it
  doesn't.

We want the server to play **no role in holding funds**. Its only job should be to **authenticate
the result**, like a Discrete Log Contract (DLC) oracle.

### Why not a real DLC

A real DLC is an **on-chain Bitcoin contract** built from adaptor signatures and a set of
pre-signed contract execution transactions (CETs). The Breez Spark SDK does not expose those
primitives, and on-chain settlement would mean confirmation waits and on-chain fees for every
match. Neither fits a quick game for a few thousand sats.

### What the SDK does give us

The Breez Spark SDK supports **conditional payments (Spark HTLCs)**, verified against the docs
and `breez/spark-sdk` snippets (`htlcs.ts`, v0.28.x):

- Send: `prepareSendPayment(...)` then
  `sendPayment({ prepareResponse, options: { type: 'sparkAddress', htlcOptions: { paymentHash, expiryDurationSecs } } })`
- The receiver sees it as a **pending** payment with `details.htlcDetails` (`paymentHash`,
  `expiryTime`, status `waitingForPreimage`), plus a `paymentPending` event.
- Claim: `claimHtlcPayment({ preimage })`
- If it's not claimed before expiry, **the funds return to the sender automatically**.
- The docs warn that preimages must be unique and are managed by the app, not the SDK.

An HTLC unlocked by a secret that only the result oracle (our server) knows gives us the DLC
property we care about: **the oracle decides who can claim, but never holds or moves money.**

## Decision

**Secure mode is the only mode.** We remove Trusted Friend mode, server-held escrow and the debts
system entirely.

### The five-step flow

1. **Two secret codes.** When a match is agreed, the server generates two random 32-byte
   preimages: `P_A` ("A wins") and `P_B` ("B wins"). It sends both players only their SHA-256
   hashes, `H_A` and `H_B`, signed by the server. Codes are unique per match.
2. **Cross-locking.** Player A sends a Spark HTLC for the stake **to B**, locked to `H_B`. Player B
   sends a Spark HTLC for the stake **to A**, locked to `H_A`. Each player's app checks for the
   **incoming** lock in its own wallet: the right `paymentHash`, amount = stake, and expiry ≥ the
   required deadline. It then sends the server a lock attestation **signed by its wallet**
   (`signMessage`). The game starts when both attestations are in.
   - Lying about an incoming lock only hurts the liar: claiming a lock that doesn't exist means
     you could win nothing. A player cannot forge the other player's attestation.
3. **Result.** When the game ends, the server releases the winning code to the winner (`P_B` if B
   won). B's app automatically calls `claimHtlcPayment({ preimage: P_B })` and receives A's stake.
   B's own lock to A is never unlocked and **returns to B at expiry**.
4. **Draw.** The server releases **both** codes. Each player claims the other's identical stake, so
   the net change is zero (minus any fees). Draws need no refund step, and rematch-on-draw is no
   longer needed to resolve money. "Rematch" is simply a new match with the same game and stake.
5. **Failure safety.** If the server crashes, a player never locks, or nobody claims, **every lock
   returns to its sender at its expiry**. No path needs the server to return money.

### Deadline (HTLC expiry)

`expiryDurationSecs = lockWindow + game.maxMatchSeconds + claimWindow`, where:

- `lockWindow` is the time allowed for both players to lock (default 180 s, `LOCK_TIMEOUT_SECONDS`).
- `maxMatchSeconds` is a **hard cap per game**, declared by the plug-in (see ADR 0006). When it's
  reached, the server ends the game per that game's rule (e.g. draw).
- `claimWindow` is the time the winner has to claim after the result (default 15 min,
  `CLAIM_WINDOW_SECONDS`). The winner's app claims instantly and retries on every reconnect. The
  server keeps re-sending the released code until the claim is confirmed or the lock expires.

### Match state machine (replaces spec §6b)

```
PROPOSED → NEGOTIATING → AGREED → AWAITING_LOCKS
AWAITING_LOCKS → (both lock attestations) IN_PROGRESS
AWAITING_LOCKS → (lock window passes) CANCELLED            // any lock returns at expiry
IN_PROGRESS → (win | forfeit | timeout) SETTLING            // winner's code released
IN_PROGRESS → (draw) SETTLING                               // both codes released
SETTLING → (claim(s) confirmed by winner's signed receipt) SETTLED
SETTLING → (claim window passes) EXPIRED                    // unclaimed lock returned to sender
any → FAILED (needs attention; logged)
```

The server persists every transition. Released codes are recorded so they can be re-sent after a
crash. On boot, the server reconciles: it resumes timers and re-sends released codes.

## Alternatives considered

| Option                                     | Why not                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Server-held escrow (original §6b)          | The server holds the money: custody risk, a hot wallet to protect, and a bigger trust ask.          |
| Trusted Friend (original §6a)              | Needs a debts system, and the loser can simply not pay. With HTLCs nobody needs to trust the loser. |
| Real on-chain DLC                          | Not supported by the SDK. Slow (confirmations) and fee-heavy for small stakes.                      |
| Lightning HODL invoices held by the server | The server would again be in the payment path. Regtest has no developed Lightning network.          |

## Consequences / trade-offs

1. **You still trust the server for the result**, exactly as a DLC trusts its oracle. The server
   could release the wrong code, but it can never take or freeze funds. The engines are
   deterministic and every move is logged, so results are auditable and replayable.
2. **Stuck funds if the opponent never locks.** If A locks and B never does, A's stake stays locked
   until A's HTLC expires, which is about the full deadline. An HTLC's deadline can't be shortened
   after sending, and releasing `H_B` early would hand the funds to B. Mitigations: hard per-game
   caps (`maxMatchSeconds`) keep deadlines short. The UI shows "Your stake returns automatically
   at HH:MM". The lock order is shown so players lock at the same time.
3. **Both players need the in-app Breez wallet.** HTLCs are sent from a Spark wallet, so paying
   from an external wallet with a QR code or `lightning:` link (spec §6b) is dropped.
4. **The winner must come back online within the claim window.** Otherwise the lock returns to the
   loser. The app auto-claims and retries on reconnect, and the claim window is generous.
5. **Fees.** Each player sends one Spark transfer per match. `prepareSendPayment` returns the fee,
   which is shown before locking.
6. **The server keeps secret codes.** A leaked `P_X` before the result would let player X claim
   early. Codes are generated with a CSPRNG, kept only server-side, and never sent before the
   result. Encryption at rest is future work.
7. **Simpler code.** The match flow has no payout queue, refund queue or debts collection. The
   ledger becomes an audit log of locks, released codes and claims.

## What else changes in the spec

- §5: the payment mode is no longer part of the proposal. The pre-lock summary shows stake,
  estimated fee, what you win, and when your stake returns if unclaimed.
- §6: replaced by this record. The network modes and the `PaymentRail` abstraction remain, but
  the interface becomes lock-oriented (`lock`, `watchIncomingLock`, `claim`, `getBalance`,
  `getFeeEstimate`) and is implemented by the **client** wallet. A mock rail still simulates
  failures (locks that never arrive, duplicate events, failed claims, expiry).
- §7: the server needs **no escrow wallet**. It keeps a small **house wallet** for the regtest
  welcome bonus, plus signature verification for login (`checkMessage`). The env var is renamed
  `ESCROW_MNEMONIC` → `HOUSE_MNEMONIC`, and the secret `REGTEST_ESCROW_MNEMONIC` →
  `REGTEST_HOUSE_MNEMONIC`.
- §8: the "Deposit" screen becomes **"Lock your stake"**, with one tap from the in-app wallet,
  a status for both locks, and a countdown. Settings no longer need a payout Lightning address.
- §11: the Trusted-mode tests are replaced by HTLC-flow tests: lock attestation, timeouts,
  draw → both claim, crash during SETTLING → code re-sent, claim after reconnect.

## Open questions

- Should signature verification on mainnet use the house wallet SDK's `checkMessage`, or a pure
  secp256k1 verifier? Decide in Phase 5 after confirming Breez's signing message format.
