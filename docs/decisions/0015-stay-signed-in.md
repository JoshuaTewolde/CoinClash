# 0015: Stay signed in on a device (with an opt-out)

- **Date:** 2026-11-15
- **Status:** Accepted (owner feedback: "you shouldn't have to sign in every time you open the app")

## Context

ADR 0012 opened the wallet only through a passkey ceremony, so every reload or app reopen needed
a tap ("Welcome back · Unlock with passkey"). For a casual game that's friction on every open. The
owner asked for sign-in to persist on the phone, with a setting to require the passkey every time.

## Decision

- After a passkey `register` or `signIn`, the passkey-derived wallet seed is saved in a **device
  vault** (`apps/web/src/wallet/vault.ts`):
  - It's encrypted with AES-GCM under a key generated in the browser as **non-extractable** and
    kept in IndexedDB.
  - On the next open, the app decrypts it and connects silently, for up to **30 days**.
  - It's bound to the network (test vs real); a mismatch wipes it.
- **Settings → Security → "Ask for my passkey every time"** (off by default) wipes the vault and
  stops saving. **Sign out** wipes it too.
- The server session token (7 days) is unchanged. When it expires, the app signs a fresh login
  nonce with the restored wallet; no user action is needed.
- On the invite page, a device that already has an account sees "Sign in to answer …" with one
  Unlock button, instead of "Make an account".

## Trade-offs

- A seed stored on the device is weaker than "passkey every time". Because the key is
  non-extractable, someone who copies the browser's files can't read the seed. But code running
  on our own origin (e.g. an XSS bug) could use the key, the same as the open app could.
  Players who want the stricter mode can turn it on.
- Real money (mainnet) should default to "ask every time". Revisit when real money is enabled
  (ADR 0010).
