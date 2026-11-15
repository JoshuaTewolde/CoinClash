# 0020: Check browser support before the passkey prompt

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Passkey wallets need WebAuthn with the PRF extension. In-app browsers (Instagram, Messenger,
TikTok, the Google app, Android webviews) and older browsers fail only after the user taps
"Create account", with a confusing error. Invite links are usually opened from chat apps, so
in-app browsers are common.

## Decision

- On the sign-up screen, `browserSupport()` checks, without loading the Breez WASM:
  1. an in-app browser user agent → `in-app`;
  2. no `PublicKeyCredential` or not a secure context → `no-passkeys`;
  3. `PublicKeyCredential.getClientCapabilities()['extension:prf'] === false` → `no-prf`;
  4. otherwise `ok`, or `unknown` when the browser can't say.
- For `in-app`, `no-passkeys` and `no-prf` it shows an "Open CoinClash in Chrome" card with a
  **Copy link** button, and points to free practice. The buttons stay enabled (the check can be
  wrong), and the SDK's `checkAvailability()` remains the final word.
- Skipped on `NETWORK=mock`.
