# A multiplayer game where players win and send bitcoin

Built with the Breez SDK. Players win sats each round and send them to each other in one tap, straight to their own wallets.

## How do I add bitcoin prizes to a multiplayer game?

In CoinClash, two friends each put up a stake before a game of Connect 4, pool, trivia, rock paper scissors or tic-tac-toe, and the winner takes the whole pot the moment the game ends. Our server's escrow wallet creates one Spark invoice per player with `receivePayment` (type `sparkInvoice`, locked to that player's wallet with `senderPublicKey`), watches for the deposits with `addEventListener`, and pays the winner with `prepareSendPayment` and `sendPayment`. Every payout carries an `idempotencyKey` built from the match and the player, so even if the server crashes mid-payout it finishes the job on restart and never pays twice.

## How can players send bitcoin to each other inside a game?

Every player gets their own Breez wallet, created from a passkey with `PasskeyClientBuilder` (fingerprint or face, no seed phrase), and paying a stake is a single "Pay 1,000 from wallet" tap that calls `prepareSendPayment` and `sendPayment` in the browser. The money then goes from the loser's stake to the winner's wallet over Spark in about a second, along with refunds when a match is a draw or cancelled. Players can also send sats to anyone straight from the Wallet screen. We first built this as direct player-to-player HTLC locks with our server acting only as a referee, but direct Spark HTLCs are disabled right now ([breez/spark-sdk#1123](https://github.com/breez/spark-sdk/issues/1123)), so stakes go through the escrow and the HTLC version waits in the code (`ESCROW_MODE=htlc`).

## How it works

- `connect({ config, seed, storageDir })` with `defaultConfig('regtest')`: opens a wallet (players in the browser, escrow and house wallets on the server)
- `PasskeyClientBuilder` + `PasskeyProvider`, `checkAvailability()`, `register()`, `signIn()`: create or restore a player's wallet from their passkey
- `signMessage()` / `checkMessage()`: wallet-signed login; the browser signs a nonce and the server verifies it
- `getInfo()`: the player's identity pubkey and balance
- `receivePayment({ type: 'sparkInvoice' })`: one deposit invoice per player per match, payable only by that player
- `receivePayment({ type: 'sparkAddress' })` / `{ type: 'bitcoinAddress' }`: addresses for receiving, and for faucet deposits
- `prepareSendPayment()` + `sendPayment({ idempotencyKey })`: paying stakes, payouts, refunds, the welcome bonus and wallet sends
- `addEventListener()`: hears `paymentSucceeded` the instant a deposit lands
- `listPayments()` / `getPayment()`: polling backup for deposits, and checking whether a payout already went out after a restart
- `listFiatRates()`: the dollar value shown next to each stake
- `sendPayment({ htlcOptions })`, `claimHtlcPayment()`: the non-custodial HTLC escrow, built and tested but switched off until #1123 is fixed

Where they are:

- `apps/web/src/wallet/breezWallet.ts`: the player's wallet in the browser (passkeys, paying, receiving, history, HTLC locks and claims)
- `apps/server/src/breez.ts`: the server's escrow wallet (invoices, deposit detection, payouts) and signature checks
- `apps/server/src/index.ts`: connects the escrow and house wallets, and reads the fiat rate
- `apps/server/src/bonus.ts`: the welcome bonus paid from the house wallet
- `apps/server/src/match/service.ts`: when deposits, payouts and refunds happen in a match

## Demo

- Live: [coinclash.vip](https://coinclash.vip) (test sats; there's also a free practice mode, no account needed)
- Short video, under one minute: [docs/media/demo-short.mp4](media/demo-short.mp4)
- Escrow transparency page: [coinclash.vip/escrow](https://coinclash.vip/escrow)

## How to run it

1. Install Node 22 or newer, and pnpm 9 (`corepack enable pnpm`).
2. `git clone https://github.com/JoshuaTewolde/CoinClash.git && cd CoinClash && pnpm install`
3. To try it with no keys at all: `NETWORK=mock MONGODB_URI=memory pnpm dev`, then open http://localhost:5173. Money moves on a simulated Spark network.
4. For real Breez payments on regtest, copy `.env.example` to `.env`.
5. Get a free Breez API key and put it in **both** `BREEZ_API_KEY` (server) and `VITE_BREEZ_API_KEY` (browser) in `.env`.
6. Generate wallets for the server with `pnpm --filter @coinclash/server regtest mnemonic` (run it twice) and put them in `HOUSE_MNEMONIC` and `ESCROW_MNEMONIC`.
7. Set `NETWORK=regtest`, `VITE_NETWORK=regtest`, a `SESSION_SECRET`, and a `MONGODB_URI` (or `memory`).
8. Fund the house wallet from the regtest faucet: `pnpm --filter @coinclash/server regtest fund HOUSE_MNEMONIC` (it falls back to printing the address for the web faucet).
9. `pnpm dev`, then open http://localhost:5173. Passkeys are tied to the domain, so wallets made on localhost stay on localhost.

More detail: [docs/testing-regtest.md](testing-regtest.md).

## Team

- Joshua Tewolde ([@JoshuaTewolde](https://github.com/JoshuaTewolde))

---

Built at Hack The Nest 2026 for </time2build>. Licensed under MIT.
