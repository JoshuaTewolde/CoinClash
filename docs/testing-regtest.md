# Testing on Breez/Spark regtest

Regtest is a real Spark test network run by Lightspark. Sats there are free and worthless.
Everything here uses **real Breez SDK calls**, unlike `NETWORK=mock`, which is used by unit tests,
CI and Playwright.

## One-time setup

1. Root `.env` (gitignored):
   - `NETWORK=regtest`
   - `BREEZ_API_KEY=…` and `VITE_BREEZ_API_KEY=…` (the same key is fine, ADR 0005)
   - `HOUSE_MNEMONIC=…` (server house wallet; pays welcome bonuses)
   - `REGTEST_PLAYER_A_MNEMONIC=…` and `REGTEST_PLAYER_B_MNEMONIC=…` (smoke-test wallets)
   - `VITE_PASSKEY_RP_ID=localhost` locally, `coinclash.vip` in production
   - `VITE_REGTEST_FAUCET_URL=https://app.lightspark.com/regtest-faucet`

   Make a new mnemonic with `pnpm --filter @coinclash/server regtest mnemonic`.

2. Fund the house wallet. The Lightspark faucet funds an **on-chain** address, and its API needs
   a Lightspark login, so this is one manual step:

   ```sh
   pnpm --filter @coinclash/server regtest fund HOUSE_MNEMONIC 100000
   ```

   The command prints the house wallet's deposit address. Open
   https://app.lightspark.com/regtest-faucet (sign in), send the sats to that address, and leave
   the command running. It waits until the deposit confirms and the SDK claims it, then prints
   the new balance. `regtest info HOUSE_MNEMONIC` shows the balance and Spark address at any time.

## Automated HTLC smoke test

```sh
pnpm --filter @coinclash/server regtest smoke
```

This checks the exact escrow primitives CoinClash relies on (ADR 0002):

1. Player A sends 1,000 sats to B's Spark address as an **HTLC** under a fresh payment hash.
2. B finds the pending HTLC with `listPayments` (`htlcStatus: waitingForPreimage`) and checks
   the amount and expiry.
3. A **wrong preimage is rejected**.
4. B claims with the right preimage (`claimHtlcPayment`), and B's balance goes up.
5. B pays the 1,000 back to A, so the test can run again. If A is short, the house tops it up.

The same test runs in GitHub Actions: **Actions → Regtest E2E → Run workflow**, and nightly. It
uses the secrets `BREEZ_API_KEY`, `REGTEST_HOUSE_MNEMONIC`, `REGTEST_PLAYER_A_MNEMONIC` and
`REGTEST_PLAYER_B_MNEMONIC`.

## Manual end-to-end checklist (two devices or two Chrome profiles)

Run `pnpm dev` with `NETWORK=regtest` (and Atlas or `MONGODB_URI=memory`), or use
https://coinclash.vip once deployed. Passkeys need a secure context: `localhost` or HTTPS.

- [ ] **Sign-up:** Player 1 opens the app, enters a nickname and taps **Create account**. Chrome
      shows the passkey prompt. After it, Home shows the wallet and a toast says the welcome sats
      are on the way. The balance becomes 10,000 sats within a few seconds.
- [ ] **Welcome bonus once:** Sign out and sign in again with the same passkey. There's no second
      bonus.
- [ ] **Returning user:** Reload the page. You get "Welcome back · Unlock with passkey". Unlocking
      opens the same wallet (same balance and address in Wallet).
- [ ] **Challenge:** Player 1 creates a tic-tac-toe challenge for 1,000 and sends the invite link.
- [ ] **Invite:** Player 2 opens the link, sees the challenge, creates an account, gets their own
      bonus, counters, and Player 1 takes the lower.
- [ ] **Lock:** Both tap **Lock**. Each wallet's balance drops by the stake. Within a few seconds
      each lock card turns "Locked" and the game starts.
- [ ] **Play to a win.** The winner sees "Collected …". The winner's balance rises by the
      opponent's stake; their own stake shows as locked in Wallet → History until it expires.
- [ ] **Loser:** Their balance stays down by the stake.
- [ ] **Draw (optional):** Both stakes are swapped back, so each balance ends where it started,
      minus fees.
- [ ] **Lock timeout:** Create a match, have only one player lock, and wait 3 minutes. The
      match is Cancelled, and that lock returns at its expiry time (shown on the screen).
- [ ] **Faucet:** Wallet → **Get deposit address** → **Open faucet** → paste → the balance rises
      after confirmation.
- [ ] **Send:** Send 100 sats to the other player's Spark address (Wallet → Receive → Copy).

## Troubleshooting

- **"Passkeys aren't set up for this site"**: `VITE_PASSKEY_RP_ID` must equal the page's domain
  (no port or scheme). Wallets are bound to it, so changing it later gives different wallets.
- **"This browser can't unlock a passkey wallet"**: the browser lacks the WebAuthn PRF extension.
  Use current Chrome (desktop or Android).
- **The server won't start on regtest**: it needs `BREEZ_API_KEY` and `HOUSE_MNEMONIC`. It
  connects the house wallet at boot to verify player signatures.
- **No welcome bonus**: the house wallet may be empty (check the `regtest info` command), or the
  IP hit the hourly limit (`WELCOME_BONUS_RATE_LIMIT_PER_HOUR`).
