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
- **DNS** (at the registrar): `A @ → 64.177.9.254` and `CNAME www → coinclash.vip`.
- **Database:** **MongoDB Atlas**, free M0 cluster, using `MONGODB_URI` (SRV string) from `.env` or
  secrets. Automated tests use `mongodb-memory-server`, so CI never touches Atlas.

## Alternatives considered

- **A separate API subdomain** (`api.coinclash.vip`): adds CORS and cookie complexity for no
  benefit at this scale.
- **Self-hosted Mongo on the Vultr box:** cheaper, but loses the Atlas prize eligibility and
  managed backups.

## Consequences / trade-offs

- Atlas network access: allow the Vultr IP (`64.177.9.254/32`) plus developers' current IPs.
  Avoid `0.0.0.0/0`; if it was added for speed, remove it once the server entry exists.
- Deploy secrets: `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_KEY`, `MONGODB_URI` and repo variable
  `DEPLOY_ENABLED=true`.

## Server provisioning (2026-11-14)

Vultr Chicago, 1 vCPU / 2 GB RAM / 55 GB SSD, Ubuntu 24.04, IPv4 `64.177.9.254`, hostname `coinclash`.

- **Access:** SSH as `root` with the ed25519 deploy key (`~/.ssh/coinclash_deploy` on the owner's
  machine; the private key is also the `VULTR_SSH_KEY` GitHub secret). **Password and
  keyboard-interactive login are disabled** (`/etc/ssh/sshd_config.d/00-coinclash.conf`), because
  the root password was shared in chat. Recovery is via the Vultr web console.
- **Installed:** Docker Engine and the Compose plugin (official Docker apt repo), fail2ban,
  unattended-upgrades. A swapfile backs the 2 GB of RAM during image builds.
- **Firewall (ufw):** deny incoming except 22/tcp, 80/tcp, 443/tcp and 443/udp (HTTP/3).
- **App directory:** `/opt/coinclash` (the Compose file, Caddyfile and server `.env` arrive in Phase 7).
- **Secrets set:** `VULTR_HOST`, `VULTR_USER=root`, `VULTR_SSH_KEY`. `DEPLOY_ENABLED` stays unset
  until the Phase 7 deploy job is real.
- Why root rather than a deploy user: it's a single-purpose, key-only box for the hackathon, and a
  non-root deploy user in the `docker` group is equivalent to root anyway.
