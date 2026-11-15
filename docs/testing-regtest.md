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

## Automated escrow smoke test

```sh
pnpm --filter @coinclash/server regtest smoke        # same as: regtest escrow-smoke
```

This checks the escrow primitives CoinClash relies on (ADR 0013), against real regtest:

1. The **escrow wallet** (`ESCROW_MNEMONIC`) issues a 1,000-sat Spark invoice bound to Player A's
   identity.
2. Player A pays it with an idempotency key.
3. The escrow finds the payment (event and `listPayments`, matched on
   `details.invoiceDetails.invoice`) and checks the amount.
4. The escrow pays it back. Repeating the payout with the same key returns the same payment, and
   `paymentStatus(key)` reports `completed`. If A is short, the house wallet tops it up first.

The same test runs in GitHub Actions (**Actions → Regtest E2E → Run workflow**, and nightly) with
the secrets `BREEZ_API_KEY`, `REGTEST_HOUSE_MNEMONIC`, `REGTEST_ESCROW_MNEMONIC`,
`REGTEST_PLAYER_A_MNEMONIC` and `REGTEST_PLAYER_B_MNEMONIC`.

The dormant HTLC test (ADR 0002) is `regtest htlc-smoke`. It currently fails with
`PermissionDenied`, because direct Spark HTLCs are disabled network-side (breez/spark-sdk#1123).

## Automated browser test against the live site

Two headless phones with Chrome's virtual passkey authenticator (PRF enabled) play a real staked
match on https://coinclash.vip. The flow: passkey sign-up, welcome bonus, invite, accept, both pay
into escrow, play, and the winner gets the pot.

```sh
PROD_URL=https://coinclash.vip pnpm --filter @coinclash/web e2e:regtest
# on a network whose DNS can't resolve an operator (e.g. campus Wi-Fi), add:
#   HOST_RESOLVER_RULES="MAP 2.spark.flashnet.xyz 104.18.22.148"
```

Without `PROD_URL`, it starts a local server (in-memory DB) and Vite against regtest instead.

## Manual end-to-end checklist (two devices or two Chrome profiles)

Use https://coinclash.vip, or run `pnpm dev` with `NETWORK=regtest` on `localhost`. Passkeys need
a secure context: `localhost` or HTTPS.

- [ ] **Sign-up:** Player 1 opens the app, enters a nickname and taps **Create account**. Chrome
      shows the passkey prompt. After it, Home shows the wallet and a toast says the welcome sats
      are on the way. The balance becomes 10,000 sats within a few seconds.
- [ ] **Welcome bonus once:** Sign out and sign in again with the same passkey. There's no second
      bonus.
- [ ] **Returning user:** Reload the page. You get "Welcome back · Unlock with passkey". Unlocking
      opens the same wallet (same balance and address in Wallet).
- [ ] **Challenge:** Player 1 creates a challenge (any of the five games) for 1,000 and sends the
      invite link.
- [ ] **Invite:** Player 2 opens the link, sees the challenge, creates an account, gets their own
      bonus, counters, and Player 1 takes the lower.
- [ ] **Pay:** Both tap **Pay … from wallet** under "Secured by CoinClash · powered by Breez".
      Each wallet's balance drops by the stake. Within a few seconds both cards turn "Secured" and
      the game starts.
- [ ] **Play to a win.** The winner sees "Paid +(2 × stake) sats to your wallet", and their
      balance rises by the whole pot at once.
- [ ] **Loser:** Their balance stays down by the stake.
- [ ] **Draw (optional):** Each stake comes straight back.
- [ ] **Deposit timeout:** Create a match, have only one player pay, and wait 3 minutes. The match
      is Cancelled and that player's stake is refunded automatically.
- [ ] **Faucet:** Wallet → **Get deposit address** → **Open faucet** → paste → the balance rises
      after confirmation.
- [ ] **Send:** Send 100 sats to the other player's Spark address (Wallet → Receive → Copy).
- [ ] **Blocked network:** On a network that can't reach a Spark operator, a red banner explains
      what to do (mobile data, VPN, or DNS 1.1.1.1).

## Troubleshooting

- **"Passkeys aren't set up for this site"**: `VITE_PASSKEY_RP_ID` must equal the page's domain
  (no port or scheme). Wallets are bound to it, so changing it later gives different wallets.
- **"This browser can't unlock a passkey wallet"**: the browser lacks the WebAuthn PRF extension.
  Use current Chrome (desktop or Android).
- **The server won't start on regtest**: it needs `BREEZ_API_KEY` and `HOUSE_MNEMONIC`. It
  connects the house wallet at boot to verify player signatures.
- **No welcome bonus**: the house wallet may be empty (check the `regtest info` command), or the
  IP hit the hourly limit (`WELCOME_BONUS_RATE_LIMIT_PER_HOUR`, 60 in production because a whole
  venue shares one Wi-Fi IP).
- **The game doesn't start after both paid**: check the server logs for `[escrow …]` lines. Each
  deposit uses the idempotency key `deposit:<matchId>:<player>`. Spark transfer ids are unique
  network-wide, so two players must never share a key.
