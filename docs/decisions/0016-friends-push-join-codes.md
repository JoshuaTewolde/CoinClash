# 0016: Challenge friends directly, push notifications, join codes and QR

- **Date:** 2026-11-15
- **Status:** Accepted (owner feedback #4, #7, #8)

## Context

Every challenge needed an invite link, even between friends who had just played. The owner asked
for:

- challenging a friend directly, with a push notification and the challenge showing in their app;
- a QR code and a short numeric code for people who aren't friends yet;
- rematch offers shown to the other player at once;
- a wallet history that names the friend and the game.

## Decisions

1. **Friends = people you've finished a match with** (the same list as the Home tiles, ADR 0009).
   - `match:create` takes an optional `opponentId`. The server allows it only if the two players
     share a past match, which stops spam challenges to strangers.
   - A direct challenge starts **NEGOTIATING** (no join step). It appears live on the friend's
     Home under **"Waiting on you"**, with a toast, and as a push notification.
   - Rematches use the same path (`rematchOf` set), so the opponent is notified the same way. The
     result screen shows "Maya wants a rematch!" as soon as it's offered.
2. **Web Push (VAPID)** via `web-push`:
   - Subscriptions are stored in a `push` collection, keyed by endpoint. Dead endpoints (404/410)
     are removed on send.
   - The service worker (`public/push-sw.js`, imported into the Workbox SW) skips the system
     notification when the app is already visible, because the live toast covers it. Tapping a
     notification opens the match.
   - Players opt in from a card on Home or the Settings toggle. Push is off on servers without
     VAPID keys.
   - Limits: Android Chrome and desktop work. iOS needs the installed app (16.4+).
3. **Open invites get a 6-digit join code** (unique among open invites, cleared once someone
   joins), shown with a **QR code** of the invite link.
   - Home has "Join with code". Any phone camera can scan the QR, so there's no in-app scanner.
   - A 6-digit space is fine for short-lived open invites. Joining only adds the joiner as
     opponent; no money moves until both players accept and pay.
4. **Wallet history from the escrow ledger** (`GET /api/activity`):
   - It lists stakes, winnings and refunds with the opponent's name and the game icon, plus the
     welcome bonus. Payouts record `paidAt`.
   - Raw wallet entries add faucet deposits and sends made from the Wallet screen (remembered
     locally), so nothing in the history is anonymous.

## Consequences

- New config: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (private key server-only).
- Tests: friend-only direct challenges, join-code life cycle, push fan-out and dead-subscription
  cleanup, activity labelling. The E2E covers a direct challenge reaching the friend's Home, the
  rematch offer, and joining by code (with the QR rendered).
