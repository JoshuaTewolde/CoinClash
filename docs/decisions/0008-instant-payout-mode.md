# 0008: Optional "Instant payout" mode (server as intermediary)

- **Date:** 2026-11-14
- **Status:** **Accepted** (owner, 2026-11-14): plan it; build as Phase 5b, after Locked mode works on regtest.

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

## Decision

The owner accepted the proposal. It's built **after** Locked mode works end-to-end on regtest
(Phase 5), as **Phase 5b**. Until then, keep HTLC deadlines short and make the pending-return time
very visible in the UI.

## Implementation plan (Phase 5b)

1. **Protocol and negotiation (`packages/shared`, machine).** Add `payout: 'locked' | 'instant'`
   to the proposal. A counter may change it, and acceptance requires both sides to agree on the
   stake **and** the payout. The default is `locked`. The challenge card shows it on its own line
   ("Instant payout: CoinClash holds the pot during the match").
2. **State machine.** `AWAITING_LOCKS` gets a sibling, `AWAITING_DEPOSITS`, with the same lock
   deadline and the same cancellation and refund semantics. For instant matches, `SETTLING` means
   "payout or refund in flight" and reaches `SETTLED` only when every ledger entry is `paid`.
   Instant matches generate no preimages.
3. **Rail (`packages/rail`).** Extend the interface with `createDepositRequest(matchId, player,
amount, expiresAt)`, an `onDeposit` stream, `findDeposit(request)` (the polling backup) and
   `pay(destination, amount, idempotencyKey)`. Implement them in `MockNetwork` first, with faults
   (duplicate events, delayed events, failed payouts), then in the Breez rail.
4. **Ledger (`db`).** A `ledger` collection with a unique index on `(matchId, kind, player)`,
   where kind is `deposit | payout | refund`. Each entry has a status (`pending → paid | failed`)
   and the SDK payment id. A payout is written as `pending` **before** `pay()` is called. On boot,
   `reconcile()` re-checks every `pending` entry against `getPayment` / `listPayments` before
   retrying, so a crash mid-payment never pays twice.
5. **Escrow wallet.** A separate `ESCROW_MNEMONIC` (not the house bonus wallet), so the pot and
   the welcome-bonus float never mix and the escrow balance can be audited against the ledger:
   the sum of unpaid deposits equals the escrow balance minus fees. It's kept only on the server
   and in GitHub secrets.
6. **UI.** A "Payout" toggle on New challenge (Locked / Instant), with an info sheet comparing the
   two. The deposit screen shows a "Pay from wallet" button (the in-app wallet pays the invoice),
   and the result screen shows "Paid" when the payout lands.
7. **Tests.**
   - Machine tests for both branches.
   - Service tests with the mock rail's faults: a lost event recovered by polling, a duplicate
     event, a payout failure followed by a retry, and a crash between the ledger write and
     `pay()`.
   - An integration test that the balances after an instant match equal the stakes ± the pot,
     with no double pay.
   - A property test that across random event orders, the ledger never pays out more than it took in.

**Out of scope for 5b:** instant mode on mainnet, which stays disabled until a separate decision
(ADR 0010), and partial refunds.
