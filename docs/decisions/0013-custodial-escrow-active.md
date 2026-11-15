# 0013: Custodial escrow is the active mode; the HTLC oracle is dormant

- **Date:** 2026-11-15
- **Status:** Accepted (owner). Amends ADR 0002 (HTLC oracle escrow) and ADR 0008 (Instant payout).

## Context

ADR 0002 designed non-custodial escrow from cross-locked Spark HTLCs. On real regtest, every
attempt to send an HTLC from one user wallet to another failed after the SDK's retries:

```
HTLC creation got leaf spending error: PermissionDenied
"consensus initiate preimage swap failed: prepare failed: rpc error: code = PermissionDenied
 desc = session identity does not match request identity"
```

This is network policy, not our code. Per **breez/spark-sdk#1123**, direct Spark HTLCs are
temporarily disabled. They only work to and from the SSP (Spark Service Provider, Lightspark's
swap service), and Breez skips its own HTLC integration tests for the same reason. Plain Spark
transfers between wallets work. We confirmed all of this on regtest from both CI and the Vultr
server.

## Decision

1. **The server holds the pot during a match (custodial escrow).** This is the ADR 0008 design,
   now the default and only active mode (`ESCROW_MODE=escrow`):
   - When the stake is agreed, the escrow wallet issues **one Spark invoice per player**: a fixed
     amount, expiring at the deposit deadline plus a short grace period, with
     `senderPublicKey = player identity` so only that player's wallet can pay it.
   - The app pays the player's own invoice in one tap. The idempotency key is
     `deposit:<matchId>`, so a double tap or retry never pays twice.
   - The server marks a deposit as paid **only when its own escrow wallet sees the payment**:
     a `paymentSucceeded` event, with `listPayments` polling as backup, matched on
     `details.invoiceDetails.invoice`. The client's `match:paid` message is only a hint to
     check now, never proof.
   - The game starts when both deposits are in.
   - **A win pays the whole pot instantly. A draw returns each stake. A deposit timeout refunds
     whoever paid.** A deposit that arrives late, after cancellation, is refunded. An underpaid
     deposit is refunded and doesn't count.
2. **Exactly-once payouts.** Obligations are recorded in the match document itself (the match's
   ledger, `payouts`), and every change to them goes through the match's optimistic version
   check.
   - The escrow pays with the idempotency key `${kind}:${matchId}:${player}`. The SDK's payment
     id is that key, so `paymentStatus(key)` tells us after a crash whether it already went out.
   - On boot, `reconcile()` resumes watching deposit invoices and finishes every open obligation
     (`payoutsOpen`, indexed), checking the payment status before paying.
   - A failed payout retries with exponential backoff. After 8 failures it is logged for an
     operator.
3. **Separate escrow wallet** (`ESCROW_MNEMONIC`), not the house/bonus wallet, so pots and the
   welcome-bonus float never mix. It's on the server and in the GitHub secret
   `REGTEST_ESCROW_MNEMONIC` only.
4. **The HTLC oracle stays dormant**, not deleted:
   - `ESCROW_MODE=htlc` re-enables it.
   - The state machine keeps `AWAITING_LOCKS`, `lockSeen`, `claimed` and the code release.
   - The app keeps `MatchAgent.lock/sync/onCode` and the "Lock your stake" screen.
   - Its tests still run (`machine.test.ts`, `service.test.ts`, `integration.test.ts`), with HTLC
     mode pinned.
   - The UI never offers it. If Breez/Lightspark re-enable direct HTLCs, or whitelist our
     wallets, switching back is one setting.
5. **Fees:** Spark-to-Spark transfers cost about 0 sats. If the SDK quotes a fee on a payout, it
   comes out of the pot, never out of the escrow wallet.
6. **UI copy:** stakes are shown as **"Secured by CoinClash · powered by Breez"**, with a shield
   icon. Any "CoinClash never holds your sats" claim is removed, because it is no longer true.
   Custody is stated plainly here and in the repo docs.

## Consequences / trade-offs

- **Custody returns.** For the duration of a match, players trust the server with the pot. A
  compromised server or escrow seed could take pots in flight. Mitigations: the escrow holds only
  live pots, it's a separate wallet, payouts are idempotent and reconciled, and the seed is
  server-only.
- **On mainnet this is money transmission territory.** Real money stays disabled (ADR 0010) until
  that is decided separately.
- **Better UX than ADR 0002:** the winner gets the whole pot at once, with no wait for their own
  HTLC to expire (ADR 0002 trade-off 8 goes away).
- The escrow balance can be audited against the ledger: received deposits minus paid
  payouts/refunds equals the escrow balance.

## Verification

- `apps/server/test/escrow.test.ts` covers the machine transitions and, against the mock escrow
  with injected faults, the service:
  - lost events recovered by polling, and duplicate events
  - a failed payout retried until it succeeds
  - a crash between paying and recording (reconcile marks it paid without paying again)
  - deposit timeout with a refund
  - the client hint
  - plus a property test that obligations never exceed deposits received
- The mock Playwright E2E plays the full pay → play → instant payout flow.
- `regtest escrow-smoke` exercises the real Breez escrow (invoice, pay, detect, payout).
