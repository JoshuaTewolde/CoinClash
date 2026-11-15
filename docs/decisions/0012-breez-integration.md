# 0012: Breez integration (Phase 5)

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Phase 5 replaces the mock wallet with the real Breez SDK (Spark) on regtest: passkey onboarding,
the browser wallet, server-side signature checks and the welcome bonus. Everything was checked
against `@breeztech/breez-sdk-spark` **0.28.4** (the installed type definitions plus the official
snippets in `breez/spark-sdk/docs/breez-sdk/snippets/wasm`), then exercised on real regtest. A
headless Chrome with a PRF virtual authenticator ran passkey sign-up, wallet connect and
`checkMessage` login; `regtest smoke` covers the HTLC calls.

## Decisions

1. **The server runs one wallet: the house wallet** (`HOUSE_MNEMONIC`, Node build
   `@breeztech/breez-sdk-spark/nodejs`, no `init()` needed). It (a) pays regtest welcome bonuses
   and (b) verifies player signatures with `checkMessage`. That method lives on a connected SDK
   instance, so the server needs some wallet connected anyway. It **never** receives or holds
   match funds (ADR 0002). Outside mock, the server refuses to start without `BREEZ_API_KEY` and
   `HOUSE_MNEMONIC`.
2. **Signatures:** clients sign with `signMessage({ message, compact: true })`. The server checks
   `checkMessage({ message, pubkey, signature }).isValid` and that the pubkey is the player's
   identity. App identity is the wallet identity pubkey (spec §7).
3. **Welcome bonus exactly once** (`src/bonus.ts`). `bonusPaidAt` is set **before** paying, and
   the payment's idempotency key is derived from `bonus:<user>`. A failure clears the mark so a
   later login retries. It's rate-limited per IP per hour (`trust proxy` = 1 hop, behind Caddy)
   and runs in the background, so login stays fast. The login reply says `bonus: 'sending'`, and
   the app shows a toast.
4. **Idempotency keys are UUIDs** (the Breez docs require it). `idempotencyUuid(key)` in
   `@coinclash/rail` hashes a logical key (`lock:<paymentHash>`, `bonus:<user>`) into a stable
   v4-layout UUID. A double tap or retry on **Lock** can never send two HTLCs.
5. **Amounts are `bigint` in the SDK** (`amount`, `fee`, `payment.amount`). They're converted at
   the wallet boundary (`BreezWallet`, `breezHouseWallet`). App code stays in plain `number` sats.
6. **Passkeys:** the client is built with `PasskeyClientBuilder` (code below), then `register` /
   `signIn` with one fixed wallet label, `coinclash`. In 0.28.4 the zero-config `PasskeyClient`
   constructor targets the Breez shared RP, so a custom rpId (`coinclash.vip`) goes through the
   builder. `checkAvailability()` gives a clear error on browsers without PRF. A passkey needs a
   user gesture, so there's no silent restore: returning players see **"Welcome back · Unlock with
   passkey"** (the nickname is remembered locally).
7. **One browser storage per wallet:** `storageDir = coinclash-<network>-<sha256(seed)[0..16]>`,
   so two accounts on one browser never share SDK state. The Breez WASM (about 12.7 MB, cached)
   is **lazy-loaded** only when a regtest or mainnet wallet opens.
8. **Incoming locks** are found with `listPayments` (receive payments, filtered to Spark HTLCs;
   code below), matched on `details.htlcDetails.paymentHash`. The agent checks the amount and `expiryTime` ≥ the agreed
   expiry before signing "lock seen". SDK events (`paymentPending` / `paymentSucceeded` /
   `synced` / `claimedDeposits`) refresh the balance. The 1.5 s poll stays as the backstop.
9. **Getting test sats:** the regtest faucet funds an **on-chain** address
   (`receivePayment({ paymentMethod: { type: 'bitcoinAddress' } })`), and the SDK claims the
   deposit after confirmation. The Wallet screen offers "Get deposit address" plus a faucet link.
   The faucet API needs a Lightspark login, so funding the house wallet is a manual step: `regtest
fund` prints the address and waits for the deposit.
10. **Vite dev must not pre-bundle the SDK** (`optimizeDeps.exclude`). Otherwise the WASM URL,
    which is relative to the SDK module, resolves to the HTML fallback.

```ts
// 6. Passkey client for our own rpId
new PasskeyClientBuilder(apiKey, { providerOptions: { rpId, rpName } })
  .withPrfProvider(new PasskeyProvider({ rpId, rpName }))
  .build();

// 8. Finding the opponent's lock
sdk.listPayments({
  typeFilter: ['receive'],
  paymentDetailsFilter: [
    { type: 'spark', htlcStatus: ['waitingForPreimage', 'preimageShared', 'returned'] },
  ],
});
```

## Alternatives considered

- **A server-only "verifier" wallet separate from the house wallet:** more secrets for no
  gain, since neither holds match funds.
- **Verifying signatures without the SDK** (secp256k1 in JS): possible, but it would hard-code
  the SDK's message hashing and encoding. `checkMessage` is the documented counterpart of
  `signMessage`.
- **Storing the passkey-derived seed in the browser** for silent restore: rejected, because it
  would turn the passkey into a formality. A tap to unlock is the price of no seed at rest.

## Consequences / trade-offs

- The server can't start on regtest if Breez is unreachable. Acceptable: logins need it anyway.
- If the house wallet is empty, new players get no bonus until it's topped up. Run
  `regtest info` to check and `regtest fund` to top up (see `docs/testing-regtest.md`).
- Wallet history shows locks with their status (locked, collected, returned). Counterparties
  aren't shown, because Spark payments don't expose the sender in the SDK.
