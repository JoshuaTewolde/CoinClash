# 0010: Players pick the network from the badge; test only for now

- **Date:** 2026-11-14
- **Status:** Accepted (owner). Supersedes ADR 0009 item 2.

## Context

ADR 0009 made the network badge status-only, with one network per deployment. The owner wants
players to choose between test sats and real money, from Settings **or** by tapping the badge on
Home. The owner also wants **everything to stay on test for now**, and to experiment with real
money only once the whole app is built.

## Decision

1. **The badge is a picker.** Tapping the Home badge opens a small dropdown menu with two options:
   **Test sats** and **Real money**. Settings offers the same choice as a radio group. Both read
   and write one per-device preference.
2. **Only enabled networks can be selected.** The server advertises `networks` in `/api/config`.
   For now that is just `NETWORK` (regtest), so **Real money is shown but disabled, with the label
   "Coming soon"**. Nothing on mainnet is reachable until a later decision turns it on.
3. **Matches stay on one network.** Once real money is enabled, each match records its network and
   only players on that network can join it. An invite opened on the other network explains this
   and offers to switch.
4. **The wallet follows the choice.** The passkey seed is the same, but the app connects the Breez
   SDK with `defaultConfig(<chosen network>)`, so each network has its own balance and address.
   Switching reconnects the wallet.

## Alternatives considered

- **Fixed per deployment (ADR 0009 item 2):** simplest and safest, but it doesn't match the
  owner's product direction.
- **Separate deployments** (`coinclash.vip` test, another domain real): keeps the code simple, but
  passkey wallets are bound to the domain (ADR 0003), so players would need separate accounts.

## Consequences / trade-offs

- Phase 4 builds the picker UI and the `networks` config, with mainnet disabled. The server-side
  work for running two networks at once (per-network rails and house wallets, a per-match network
  field and the join check) is deferred until the real-money experiment, with Phase 9.
- Turning on real money later also needs the spec's mainnet safeguards: the REAL MONEY badge, a
  confirmation step and stake caps.
