# Writing a game

Games are plug-ins that know **only the rules**. Accounts, invites, stakes, HTLC locks, timers
and payouts are handled by the platform, so you never touch payment code. Background:
[ADR 0006](decisions/0006-game-plugin-interface.md). Reference implementation:
`packages/games/tictactoe`.

## 1. Create the package

```
packages/games/<id>/
  package.json        name "@coinclash/game-<id>", exports { "./engine": "./src/engine.ts" }
  tsconfig.json       extends ../../../tsconfig.base.json
  vitest.config.ts    defineProject({ test: { name: '<id>', include: ['test/**/*.test.ts'] } })
  src/engine.ts       your GamePlugin (pure: no React, no I/O)
  src/Board.tsx       React board, exported as "./board" (web only)
  test/engine.test.ts
```

Add `"@coinclash/game-sdk": "workspace:*"` (and `zod` for move parsing) to dependencies, then run
`pnpm install`.

## 2. Implement `GamePlugin<State, Move, View>`

```ts
import { createRng, invalid, type GamePlugin } from '@coinclash/game-sdk';

export const myGame: GamePlugin<MyState, MyMove, MyView> = {
  id: 'mygame',              // stable forever: stored in match records
  name: 'My Game',
  minPlayers: 2, maxPlayers: 2,
  turnModel: 'alternating',  // or 'simultaneous' (everyone moves, then reveal)
  defaultTurnSeconds: 60,
  maxMatchSeconds: 900,      // HARD upper bound: stake HTLC expiries derive from it
  init({ players, seed, options }) { ... },
  activePlayers(state) { ... },             // who the server is waiting on
  validateMove(state, player, raw) { ... }, // parse untrusted input; return invalid('why')
  applyMove(state, player, move) { ... },   // return a NEW state
  getResult(state) { ... },                 // ongoing | win | draw (reason: 'normal')
  viewFor(state, player) { ... },           // hide secrets from `player`
  legalMoves(state, player) { ... },        // optional, but enables the fuzz tests
};
```

Rules:

- **Pure and deterministic.** No `Math.random`, `Date.now`, network or globals. Get randomness
  from `createRng(seed)`, or `createRng(deriveSeed(seed, 'round', n))` mid-game, keeping `n` in
  state.
- **State is plain JSON data** (no classes, Maps or functions). It is persisted and replayed.
- **Never mutate** the input state. Tests deep-freeze it.
- **`validateMove` must never throw.** Parse with zod and return `invalid(reason)`.
- **`viewFor` hides secret info.** For example, an opponent's RPS pick before reveal, or trivia
  answers before the timer ends. It must be JSON-serializable.
- Forfeits, disconnects and the match cap are handled by the platform. Override `onTimeout` or
  `onMatchCap` only if your game needs different behaviour (e.g. RPS: a timeout loses the round,
  not the match).

## 3. Test it

```ts
import { checkPluginContract } from '@coinclash/game-sdk/testing';
it('satisfies the plug-in contract', () => checkPluginContract(myGame, { maxSteps: 200 }));
```

Also write explicit tests for every win condition, draws, illegal input, timeouts, and that
`viewFor` leaks nothing. Engines need **≥ 90% coverage** (enforced in `vitest.config.ts`).

## 4. Register it

Add it to the server's game registry and the web app's board map (wired up in Phases 3–4).

## Future work

Plug-ins are in-repo and trusted. Running third-party plug-ins would need sandboxing (a worker
or isolate with no I/O, CPU and memory limits, and a time budget per call).
