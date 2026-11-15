# 0003: Chrome-only target, two-button passkey flow

- **Date:** 2026-11-14
- **Status:** Accepted

## Context

Wallets are derived from a passkey through the WebAuthn **PRF** extension, using Breez's
`PasskeyClient` from `@breeztech/breez-sdk-spark/passkey-prf-provider`. PRF support varies by
browser and authenticator, and the one-button `connectWithPasskey` flow needs "immediate
mediation", which not every browser has.

## Decision

- **Target Chrome** (desktop and Android) for the hackathon. Other browsers get a clear
  "Open in Chrome" screen when `checkAvailability()` reports `prfUnsupported`.
- Use the **two-button flow**: **Create account** (`register({ label })`) and **Sign in**
  (`signIn({ label, allowCredentials })`). Store the returned `credentialId` so sign-in pins the
  same credential and can't open a different wallet.
- Passkey `rpId` = the serving domain: `localhost` in development, `coinclash.vip` in production.

## Alternatives considered

- **One-button `connectWithPasskey`**: nicer, but only where immediate mediation is supported.
  We can add it later behind `supportsImmediateMediation()`.
- **Mnemonic fallback for unsupported browsers**: shows a seed phrase, which the spec wants to
  avoid. Left out for now.

## Consequences / trade-offs

- Safari and Firefox users are told to switch browsers for now.
- Wallets are bound to the `rpId`. Wallets created on `localhost` won't open on `coinclash.vip`.
  That's fine for development, but test users must use the production domain.
- On Windows desktop Chrome, PRF depends on the authenticator (Google Password Manager or a phone
  via hybrid). `checkAvailability()` decides at runtime.
