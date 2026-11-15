# 0004: Hosting at coinclash.vip on Vultr, MongoDB Atlas

- **Date:** 2026-11-14
- **Status:** Accepted

## Context

Passkeys and PWA install both need HTTPS on a real domain. The hackathon also has a prize track
for MongoDB Atlas.

## Decision

- **Domain:** `coinclash.vip`. The web app and API share one origin: static files at `/`, the API
  under `/api`, and Socket.IO at `/socket.io`. That avoids CORS and keeps the passkey `rpId`
  simple.
- **Server:** one Vultr instance running Docker, with **Caddy** in front for automatic HTTPS
  (Let's Encrypt).
- **DNS** (at the registrar, once the Vultr IP exists): `A @ → <Vultr IPv4>` and
  `CNAME www → coinclash.vip`.
- **Database:** **MongoDB Atlas**, free M0 cluster, using `MONGODB_URI` (SRV string) from `.env` or
  secrets. Automated tests use `mongodb-memory-server`, so CI never touches Atlas.

## Alternatives considered

- **A separate API subdomain** (`api.coinclash.vip`): adds CORS and cookie complexity for no
  benefit at this scale.
- **Self-hosted Mongo on the Vultr box:** cheaper, but loses the Atlas prize eligibility and
  managed backups.

## Consequences / trade-offs

- Atlas network access is `0.0.0.0/0` during the hackathon for speed. Later, restrict it to the
  Vultr IP and developers' IPs.
- Deploy secrets: `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_KEY`, `MONGODB_URI` and repo variable
  `DEPLOY_ENABLED=true`.
