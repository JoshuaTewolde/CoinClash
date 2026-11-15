# 0009: UI feedback, round 1 (Home screen)

- **Date:** 2026-11-14
- **Status:** Accepted. Source: owner comments on the design canvas.

## Decisions

1. **Friend tiles on Home show the day streak, not win/loss.** Each friend tile shows a big
   "N-day streak" with a flame icon, and "N games played" small underneath. A streak is the number
   of consecutive calendar days (in the viewer's timezone) with at least one _finished_ match
   against that friend, ending today or yesterday. The win/loss record moves to a **friend detail
   screen**, broken down on a tile per game.
   - Why: streaks reward playing together (and using Breez payments) every day. Win/loss in a
     prominent spot can discourage the friend who's behind.
2. **The network badge is a status, not a toggle.** The network is fixed per deployment
   (`NETWORK`). Players can't switch it, so test sats and real money never mix in one wallet.
   It shows TEST SATS (teal) on regtest and REAL MONEY (tomato) on mainnet.

3. **The stake is typeable.** The stake number is a text input with `inputmode="numeric"` (numeric
   keypad on phones). It keeps digits only, formats with separators, and clamps to
   `STAKE_MIN_SATS`–`STAKE_MAX_SATS` on blur. The –/+ buttons and presets stay.
4. **Each game has its own icon** in place of text glyphs. They're inline stroke SVGs in the Sticker
   Arcade style (3px ink stroke, flat fills): a mini board (Tic-tac-toe), a rack with discs
   (Connect 4), scissors, rock and paper (RPS), and a question bubble (Trivia). Labels always stay
   visible next to the icon.

## Consequences

- The server needs a per-friend stats query (streak, games played, per-game record) from
  finished matches. It's added with the Home screen in Phase 4.
