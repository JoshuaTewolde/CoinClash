# CoinClash: Breez SDK write-up

**Hack The Nest 2026 · Breez "Multiplayer Game Prizes" bounty**
Live at [coinclash.vip](https://coinclash.vip) · built on `@breeztech/breez-sdk-spark` 0.28.4 (Spark, regtest)

## What we built

CoinClash lets friends play quick turn-based games against each other for sats. Right now there are five: tic-tac-toe, Connect 4, rock paper scissors, trivia and 8-ball pool. You sign up with a passkey, challenge a friend, both of you put up a stake, and whoever wins gets the whole pot the second the game ends. It runs in the browser as an installable web app, so the same thing works on Android and iPhone, which was the whole point for me, since I'm the one Android user who could never join my friends' iMessage games.

Every match moves real Breez payments: a welcome bonus when you sign up, two stake deposits, and a payout (or two refunds if it's a draw or the match is cancelled). Even with test sats, you get the full experience of sending and receiving money in one tap.

## How we use the Breez SDK

We use both builds of the SDK: the WebAssembly build in the browser for each player's own wallet, and the Node build on our server for the escrow wallet and a "house" wallet.

| What                            | Breez API                                                                                                                                                                       | Where   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Wallet with no seed phrase      | `PasskeyClientBuilder` + `PasskeyProvider`, `checkAvailability()`, `register()` / `signIn()`, then `connect()` with the derived seed                                            | Browser |
| Logging in to our server        | `signMessage()` signs a one-time nonce in the browser; the server checks it with `checkMessage()` and uses `getInfo().identityPubkey` as the player's id                        | Both    |
| Balance                         | `getInfo({ ensureSynced })`                                                                                                                                                     | Both    |
| Stake deposits                  | The escrow creates one `receivePayment({ type: 'sparkInvoice', amount, expiryTime, senderPublicKey })` per player, so each invoice can only be paid by that player's own wallet | Server  |
| Paying a stake                  | `prepareSendPayment()` + `sendPayment()` with a UUID `idempotencyKey`                                                                                                           | Browser |
| Detecting deposits              | `addEventListener()` for `paymentSucceeded`, with `listPayments()` / `getPayment()` as a polling backup                                                                         | Server  |
| Payouts, refunds, welcome bonus | `prepareSendPayment()` + `sendPayment()` to the player's Spark address, with an idempotency key derived from the match and player                                               | Server  |
| Receiving                       | `receivePayment({ type: 'sparkAddress' })`, plus `bitcoinAddress` for faucet deposits                                                                                           | Browser |
| Dollar values                   | `listFiatRates()` (shown next to the stake)                                                                                                                                     | Server  |
| Non-custodial escrow (dormant)  | `sendPayment` with `htlcOptions`, `listPayments` filtered by `htlcStatus`, `claimHtlcPayment()`                                                                                 | Both    |

## Design decisions around payments

**Paying exactly once.** The thing I worried about most was paying someone twice, or not at all, if the server crashed in the middle of a payout. Each match document in MongoDB carries its own little ledger of what it owes, and every payout uses an idempotency key built from the match id and the player (`payout:<match>:<player>`), hashed into the UUID format the SDK requires. On restart the server looks for unpaid entries, asks the SDK whether that key already went through, and only pays what's still missing. The welcome bonus works the same way with `bonus:<user>`.

**Invoices locked to a player.** Using `senderPublicKey` on the deposit invoices meant we never had to guess who paid what. If someone pays too little or too late, the escrow refunds it automatically.

**Keeping ourselves out of the middle (the plan we couldn't ship).** Our original design never held anyone's money. Each player would lock their stake to their opponent with a Spark HTLC, and our server would act only as an oracle, revealing the preimage for the winner's side once the game was decided. If anything went wrong, the locks would just expire back to their owners. We built and tested the whole thing, but on the network every lock failed with `PermissionDenied`, because direct HTLCs between user wallets are currently disabled ([breez/spark-sdk#1123](https://github.com/breez/spark-sdk/issues/1123)). With the deadline coming, we switched to the custodial escrow described above, and added a public [escrow page](https://coinclash.vip/escrow) that shows what the escrow wallet holds against what it owes to every live match. The HTLC version is still in the code behind `ESCROW_MODE=htlc`, ready to turn back on.

## What worked well

- **Passkey wallets are the best part of the SDK for us.** Signing up with a fingerprint and having a working Bitcoin wallet a few seconds later is the kind of onboarding a game needs. Nobody in our tests was asked to write anything down.
- **Spark payments are fast.** Deposits and payouts land in about a second, which is what makes "the winner gets paid instantly" true.
- **Sign/check message** gave us wallet-based login for free, with no passwords or email.
- **Idempotency keys** made safe retries straightforward once we understood them.
- **The same API in the browser and in Node** let us share a lot of code and mental model between the client and server.

## Problems we hit, and feedback

1. **HTLCs between user wallets are disabled** (#1123). This was the big one, since it forced our whole design toward custody. If there's a timeline for re-enabling them, or a supported way to do conditional payments, we would switch back straight away.
2. **`idempotencyKey` has to be a UUID.** That makes sense, but we first passed readable keys like `payout:abc:alice` and only found out from the error. A note in the docs, or accepting any string and hashing it, would help.
3. **WebAssembly in Vite.** Vite's dependency pre-bundling broke the WASM load (it got served as HTML). Adding the package to `optimizeDeps.exclude` fixed it; a line about this in the web setup docs would have saved us an hour.
4. **Passkeys are bound to the domain.** Wallets created on localhost or a temporary tunnel can't be opened on the real domain, so we picked coinclash.vip on day one. Worth calling out loudly in the passkey guide.
5. **Some networks can't reach the Spark operators.** Our campus Wi-Fi couldn't resolve one operator's hostname, so payments silently failed from my laptop while working fine on mobile data. We added a check in the app that warns players when their network blocks a payment server. A clearer error from the SDK in this case would help other builders.
6. **Regtest funding.** The faucet API needed a login we didn't have, so we fell back to the web faucet by hand. A simple funded test account or a CLI faucet would make CI easier.
7. **Separate storage per wallet.** Running two wallets (escrow and house) in one Node process needs a separate `storageDir` for each, and one wallet needs to sync before it can spend. Obvious in hindsight, but it cost us a confusing "insufficient funds" error.

## Testing

All money code goes through one interface with an in-memory mock of the Spark network, so we could test failures on purpose: dropped payment events, duplicate events, failed payouts, and the same idempotency key being reused. On top of that we have more than 400 unit and integration tests, Playwright tests that drive two phones through a full match for every game, and a regtest test that signs up two players with Chrome's virtual passkey authenticator and plays a real staked match against the live site.

## What's next

- Switch the HTLC escrow back on when #1123 is resolved, so CoinClash never holds stakes.
- Mainnet, with Lightning deposits from any wallet and dollar amounts on every balance.
- Group pots and tournaments for more than two players.
- Opening the game plug-in interface so other developers can add their own games and get instant, escrowed payouts.
