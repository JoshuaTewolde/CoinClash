/**
 * Test helpers for game plug-ins: `@coinclash/game-sdk/testing`.
 * Test-only: imports fast-check and node:util, so never import this from app code.
 *
 *   it('satisfies the plug-in contract', () => checkPluginContract(myGame));
 */
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { createRng, type Rng } from './rng.js';
import {
  isOver,
  replaySession,
  sessionResult,
  startSession,
  submitMove,
  timeoutPlayer,
  waitingOn,
  type GameSession,
} from './session.js';
import { isInvalid, type GamePlugin, type InitContext, type PlayerId } from './types.js';

export const TEST_PLAYERS: readonly PlayerId[] = ['alice', 'bob'];

export function testContext(seed = 'test-seed', options?: unknown): InitContext {
  return { players: TEST_PLAYERS, seed, options };
}

/** Deep-freeze a value so any accidental mutation in an engine throws in tests. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export interface PlaythroughOptions {
  /** Stop after this many steps even if the game is not over. */
  maxSteps?: number;
  /** Probability (0–1) that a waiting player times out instead of moving. */
  timeoutRate?: number;
}

/**
 * Play random legal moves (and occasional timeouts) until the game ends. Requires
 * `plugin.legalMoves`. States are deep-frozen before every move to catch mutation.
 */
export function randomPlaythrough<S, M, V>(
  plugin: GamePlugin<S, M, V>,
  ctx: InitContext,
  rng: Rng,
  { maxSteps = 500, timeoutRate = 0 }: PlaythroughOptions = {},
): GameSession<S> {
  if (!plugin.legalMoves) throw new Error(`${plugin.id} has no legalMoves(); cannot fuzz`);
  let session = startSession(plugin, ctx);
  for (let step = 0; step < maxSteps && !isOver(plugin, session); step++) {
    deepFreeze(session.state);
    const player = rng.pick(waitingOn(plugin, session));
    if (rng.next() < timeoutRate) {
      session = timeoutPlayer(plugin, session, player);
      continue;
    }
    const moves = plugin.legalMoves(session.state, player);
    if (moves.length === 0)
      throw new Error(`${plugin.id}: waiting on ${player} but no legal moves`);
    const outcome = submitMove(plugin, session, player, rng.pick(moves));
    if (!outcome.ok) throw new Error(`${plugin.id}: legal move rejected: ${outcome.reason}`);
    session = outcome.session;
  }
  return session;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface ContractOptions {
  /** fast-check runs per property (default 200). */
  numRuns?: number;
  /** Options passed to `init` (default undefined). */
  options?: unknown;
  /** Upper bound on steps; the game must finish within it (default 500). */
  maxSteps?: number;
}

/**
 * Property-based checks every game must pass:
 * 1. `init` is deterministic for a seed.
 * 2. Random legal play (with timeouts) never crashes and always terminates.
 * 3. Replaying the event log reproduces the identical state and result.
 * 4. Finished games reject further moves and wait on nobody.
 * 5. `viewFor` is JSON-serializable for each player and observers.
 * 6. Arbitrary junk input to `validateMove` never throws.
 */
export function checkPluginContract<S, M, V>(
  plugin: GamePlugin<S, M, V>,
  { numRuns = 200, options, maxSteps = 500 }: ContractOptions = {},
): void {
  const seedArb = fc.string({ minLength: 1, maxLength: 24 });

  fc.assert(
    fc.property(seedArb, (seed) => {
      const ctx = testContext(seed, options);
      assert(isDeepStrictEqual(plugin.init(ctx), plugin.init(ctx)), 'init is not deterministic');
    }),
    { numRuns },
  );

  fc.assert(
    fc.property(
      seedArb,
      seedArb,
      fc.double({ min: 0, max: 0.2, noNaN: true }),
      (seed, playSeed, timeoutRate) => {
        const ctx = testContext(seed, options);
        const session = randomPlaythrough(plugin, ctx, createRng(playSeed), {
          maxSteps,
          timeoutRate,
        });
        assert(isOver(plugin, session), `game did not finish within ${maxSteps} steps`);

        const replayed = replaySession(plugin, ctx, session.events);
        assert(
          isDeepStrictEqual(replayed.state, session.state),
          'replay produced a different state',
        );
        assert(
          isDeepStrictEqual(sessionResult(plugin, replayed), sessionResult(plugin, session)),
          'replay produced a different result',
        );

        assert(waitingOn(plugin, session).length === 0, 'finished game still waits on players');
        for (const p of ctx.players) {
          assert(!submitMove(plugin, session, p, null).ok, 'finished game accepted a move');
        }

        for (const viewer of [...ctx.players, null]) {
          const view = plugin.viewFor(session.state, viewer);
          assert(
            isDeepStrictEqual(JSON.parse(JSON.stringify(view)), view),
            'viewFor is not JSON-serializable',
          );
        }
      },
    ),
    { numRuns },
  );

  fc.assert(
    fc.property(seedArb, fc.anything(), (seed, junk) => {
      const session = startSession(plugin, testContext(seed, options));
      for (const p of session.ctx.players) {
        const result = plugin.validateMove(session.state, p, junk);
        // Either rejected, or a move that applies cleanly.
        if (!isInvalid(result)) plugin.applyMove(session.state, p, result);
      }
    }),
    { numRuns },
  );
}
