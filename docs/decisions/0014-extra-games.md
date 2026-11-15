# 0014: Connect 4, Rock Paper Scissors, Trivia and Pool

- **Date:** 2026-11-15
- **Status:** Accepted

## Context

Spec §4 lists four games after tic-tac-toe. With the deadline close, each game was built by its
own agent in an isolated git worktree (branch `game/<id>`), working only inside
`packages/games/<id>` plus one registration line on the server and web. Each was merged into
`main` once its own gates passed (lint, format, typecheck, coverage ≥90%, build, E2E). No game
touched match, escrow, rail, auth or protocol code: the `GamePlugin` interface (ADR 0006)
handled alternating play, simultaneous play and physics without changes.

## What shipped

| Game          | Turn model   | Notes                                                                                                                                                                                       |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect 4     | alternating  | 7×6 with gravity, four in a row in any direction, draw on a full board, bouncing disc drop.                                                                                                 |
| RPS           | simultaneous | Best of 3 (option: 5). Tied rounds replay. A missed pick loses the round. `viewFor` never reveals the opponent's pick early.                                                                |
| Trivia        | simultaneous | 177 original bundled questions. 5 questions, 20 s each. Sudden death up to 3, then a draw. The answer and the opponent's choice stay hidden until both answer.                              |
| Pool (8-ball) | alternating  | Deterministic **integer** physics (CORDIC angles, integer sqrt, fixed timestep). The server simulates every shot; the board replays the frames. Simplified rules, drag-to-aim plus sliders. |

## Deviations from spec §4 (and why)

- **RPS can end in a draw**, but only after a 9-round cap (15 for best of 5). The spec says a
  match never draws. However, every match must finish within the escrow deposit deadline and
  `maxMatchSeconds`. In practice it needs 9 rounds without two round wins from either player. At
  the cap, whoever leads wins and only an even score draws, which returns both stakes.
- **Trivia uses 5 questions at 20 s each, with no speed bonus, from a bundled bank** rather than 10
  questions at 15 s from OpenTDB:
  - Shorter matches suit phone play and the demo.
  - A bundled, seed-picked bank keeps the engine pure and deterministic and works offline.
  - Questions are original, so there are no licensing concerns.
  - A server-side speed bonus would need a timing input in the engine; it's future work.
- **Pool rules are simplified further:** no ball-in-hand (the cue respawns at the head spot), no
  spin, no called pocket. There is a hard limit of 150 shots, judged like the match cap, so every
  game ends.

## Consequences

- E2E: each game has a two-phone Playwright spec on the mock rail, paying into escrow.
- The web registry lists all five games. The server's `/api/config` decides which are playable.
- E2E ports are fixed (5174/8788), so parallel worktrees must not run E2E at the same time.

## Pool UI update (2026-11-15, owner feedback)

- **Every shot replays on both phones.** The replay is keyed on the shot number. The shooter
  receives the same shot twice (move reply plus broadcast), and the second copy used to cancel
  the replay.
- **Full table:** turning a phone sideways (or tapping "⟲ Full table") fills the screen, and on
  Android Chrome it goes full screen and locks landscape.
  - **Power cue on the right edge:** pull down to set power, release to shoot. A tiny pull
    cancels. It slides away while it isn't your shot.
  - **Fine-aim strip on the left edge**, so the right hand handles power and the left handles aim.
  - **Top bar:** your group and remaining balls, the turn and status, then the opponent's.
- **Aim:** drag on the felt and the cue points at your finger. A ghost ball marks the first
  contact, and a short line shows the object ball's direction (equal-mass, line of centres).
- **Your balls pulse twice** at the start of each of your turns. Tap "You: Solids/Stripes" to
  replay the pulse.
- **Result screen:** the board renders in `review` mode (no controls, no aim), and the
  game-ending shot replays there.
