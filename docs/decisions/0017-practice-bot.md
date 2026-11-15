# 0017: Free practice against a bot

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Every game needed a second person with a passkey wallet. A judge or a new visitor with one phone
couldn't try anything without signing up and finding a friend.

## Decision

- `/practice` (and `/practice/:gameId`) lets anyone play **CoinBot** at every game, **free and
  without an account**. It's linked from the sign-up screen ("Try a free practice game first") and
  from Home ("Practice (free)").
- The game runs **entirely in the browser** with the same pure engines the server uses
  (`startSession` / `submitMove` from `@coinclash/game-sdk`). No server, socket, wallet or sats are
  involved, so it can't affect money and needs no new protocol.
- The bot (`apps/web/src/practice/bot.ts`) is beatable on purpose:
  - Tic-tac-toe and Connect 4: take a win, otherwise avoid moves that hand you a win (which also
    blocks), preferring the centre. It sometimes skips the safety check (20% / 15%).
  - Trivia: right about 6 times in 10 (uses the exported `correctChoice`; the bot runs locally,
    so this leaks nothing in real matches, where the server only sends `viewFor`).
  - Pool: tries aimed shots near every ball at two powers, simulates each with the engine and
    keeps the best (pots its group, keeps the turn, avoids fouls).
  - RPS: random.

## Consequences

- No turn timers in practice.
- The engines are now in the web bundle (they were mostly already there through the boards).
- Tests: bot win/block/trivia unit tests, bot-vs-bot games always finish with legal moves, and a
  signed-out practice E2E.
