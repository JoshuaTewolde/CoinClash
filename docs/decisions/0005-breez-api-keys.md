# 0005: One Breez API key for now

- **Date:** 2026-11-14
- **Status:** Accepted (revisit before mainnet)

## Context

The Breez SDK requires an API key in every place it runs: each player's browser wallet and the
server's house wallet. A key used in the browser is **public**: it is baked into the JS bundle
(`VITE_BREEZ_API_KEY`) and anyone can read it.

## Decision

Use **one key** for both the browser and the server during the hackathon. It's stored in the
local `.env` (gitignored) and the `BREEZ_API_KEY` GitHub secret.

## Why a second key could help later

A key can't be made more secret than the browser bundle, so a second key doesn't protect the
browser key. It gives **separation**:

- If the public key is abused or rate-limited and Breez revokes it, the server's house wallet
  keeps working on its own key, and vice versa.
- Usage and quota can be tracked separately.
- Rotating the public key won't require redeploying server secrets.

## Consequences / trade-offs

- For now, revoking the key affects both the browser and the server.
- **Before mainnet:** request a second key and set it as the server's `BREEZ_API_KEY`, keeping the
  current one as `VITE_BREEZ_API_KEY`.
