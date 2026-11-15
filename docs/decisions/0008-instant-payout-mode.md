# 0008: Optional "Instant payout" mode (server as intermediary)

- **Date:** 2026-11-14
- **Status:** **Proposed**, awaiting a decision from the project owner.

## Context

ADR 0002, trade-off 8: with cross-locked HTLCs, the winner claims the loser's stake immediately,
but **the winner's own stake only returns when its HTLC expires** (tens of minutes). Players asked
whether an opt-in setting could make winnings fully available at once.

## Can it be done without custody?

We looked for a non-custodial fix and found none with the current SDK:

- A Spark HTLC **can't be cancelled by its sender** before expiry, and only its single receiver can
  claim it. There is no "pay A or B" HTLC.
- Releasing the loser's code to "unlock" the winner's stake sends that stake **to the loser**.
- Having the loser's app claim the winner's lock and pay it back depends on the loser's
  cooperation, so a malicious loser could keep it. That's worse than waiting.
- **Shorter deadlines** are the only non-custodial lever: they reduce the wait but don't remove it.

## Proposal

Add an opt-in **Instant payout** mode, agreed by **both** players during negotiation like any other
term (Locked stays the default):

1. On agreement, the server creates **one single-use Spark invoice per player**
   (`receivePayment({ paymentMethod: { type: 'sparkInvoice', amount, expiryTime } })`), matched to
   the incoming payment by `details.invoiceDetails.invoice`.
2. The game starts once **both deposits are confirmed** by the server's own wallet (no client
   attestations needed).
3. On the result, the server pays the **whole pot** to the winner at once. On a draw, it refunds
   both. If the deposit window times out, it refunds whoever paid.
4. Payouts and refunds go through an **idempotent ledger**: one entry per deposit, payout or
   refund, keyed by match and player, holding the SDK payment id. They're never paid twice, and
   on boot the server reconciles.

This is essentially the original spec §6b escrow, restricted to players who choose it.

## Trade-offs

- **Custody returns:** the server holds the pot during the match, so we need a funded hot escrow
  wallet whose mnemonic lives only on the server. The UI must say "CoinClash holds the pot during
  this match" plainly.
- **More code and tests:** escrow wallet, deposit detection (events plus polling), ledger,
  idempotent payouts, refunds and reconciliation. This is roughly the Phase 3 effort again on the
  money side.
- **Regulatory optics** on mainnet (holding other people's money) are worse than for Locked mode.
- Both match flows share the state machine. The mode-specific branches are confined to
  `AWAITING_LOCKS` vs `AWAITING_DEPOSITS` and to settlement.

## Recommendation

Build it **after** Locked mode works end-to-end on regtest (Phase 5), as a Phase 5b, and only if
time allows before the deadline. Meanwhile, keep HTLC deadlines short and make the pending-return
time very visible in the UI.
