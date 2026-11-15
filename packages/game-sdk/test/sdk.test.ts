import { describe, expect, it } from 'vitest';
import {
  applyMatchCap,
  createRegistry,
  createRng,
  deriveSeed,
  forfeit,
  invalid,
  isInvalid,
  isOver,
  replaySession,
  sessionResult,
  startSession,
  submitMove,
  SUPPORTED_PLAYER_COUNT,
  timeoutPlayer,
  waitingOn,
  type GamePlugin,
} from '../src/index.js';
import {
  checkPluginContract,
  deepFreeze,
  randomPlaythrough,
  TEST_PLAYERS,
  testContext,
} from '../src/testing.js';
import { pileGame, type PileState } from './fixtures.js';

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    const c = createRng('other');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int, pick and shuffle stay in range and do not mutate', () => {
    const rng = createRng('x');
    const items = Object.freeze([1, 2, 3, 4, 5]);
    for (let i = 0; i < 200; i++) {
      const n = rng.int(3);
      expect(Number.isInteger(n) && n >= 0 && n < 3).toBe(true);
      expect(items).toContain(rng.pick(items));
    }
    const shuffled = rng.shuffle(items);
    expect([...shuffled].sort()).toEqual([...items]);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('is roughly uniform', () => {
    const rng = createRng('uniform');
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) counts[rng.int(4)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(1700);
  });

  it('rejects bad ranges', () => {
    const rng = createRng('x');
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('derives distinct sub-seeds', () => {
    expect(deriveSeed('m', 'round', 1)).not.toBe(deriveSeed('m', 'round', 2));
    expect(deriveSeed('m', 'round', 1)).toBe(deriveSeed('m', 'round', 1));
  });
});

describe('invalid moves', () => {
  it('recognises InvalidMove values only', () => {
    expect(isInvalid(invalid('nope'))).toBe(true);
    expect(isInvalid({ invalid: true })).toBe(false);
    expect(isInvalid(null)).toBe(false);
    expect(isInvalid({ cell: 1 })).toBe(false);
  });
});

describe('sessions', () => {
  const ctx = testContext('s');

  it('validates player count and uniqueness', () => {
    expect(SUPPORTED_PLAYER_COUNT).toEqual({ min: 2, max: 2 });
    expect(() => startSession(pileGame, { players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => startSession(pileGame, { players: ['a', 'a'], seed: 's' })).toThrow(/distinct/);
  });

  it('applies legal moves, logs them, and ends the game', () => {
    let s = startSession(pileGame, ctx);
    for (const [player, take] of [
      ['alice', 2],
      ['bob', 2],
      ['alice', 1],
    ] as const) {
      const out = submitMove(pileGame, s, player, { take });
      expect(out.ok).toBe(true);
      if (out.ok) s = out.session;
    }
    expect(sessionResult(pileGame, s)).toEqual({
      status: 'win',
      winner: 'alice',
      reason: 'normal',
    });
    expect(s.events).toHaveLength(3);
    expect(waitingOn(pileGame, s)).toEqual([]);
    expect(submitMove(pileGame, s, 'bob', { take: 1 })).toEqual({
      ok: false,
      reason: 'Game is over',
    });
  });

  it('rejects strangers, wrong turns and invalid moves', () => {
    const s = startSession(pileGame, ctx);
    expect(submitMove(pileGame, s, 'eve', { take: 1 })).toEqual({
      ok: false,
      reason: 'Not a player in this game',
    });
    expect(submitMove(pileGame, s, 'bob', { take: 1 })).toEqual({
      ok: false,
      reason: 'Not your turn',
    });
    expect(submitMove(pileGame, s, 'alice', { take: 3 })).toEqual({
      ok: false,
      reason: 'take must be 1 or 2',
    });
  });

  it('contains plug-ins whose validateMove throws', () => {
    const buggy: GamePlugin<unknown, unknown, unknown> = {
      ...(pileGame as unknown as GamePlugin<unknown, unknown, unknown>),
      validateMove: () => {
        throw new Error('boom');
      },
    };
    const s = startSession(buggy, ctx);
    expect(submitMove(buggy, s, 'alice', {})).toEqual({ ok: false, reason: 'Invalid move' });
  });

  it('uses onTimeout when the plug-in defines it, ignoring players not on move', () => {
    const s = startSession(pileGame, ctx);
    expect(timeoutPlayer(pileGame, s, 'bob')).toBe(s);
    const skipped = timeoutPlayer(pileGame, s, 'alice');
    expect(waitingOn(pileGame, skipped)).toEqual(['bob']);
    expect(isOver(pileGame, skipped)).toBe(false);
  });

  it('forfeits on timeout by default', () => {
    const { onTimeout: _drop, ...rest } = pileGame;
    const plain = rest as typeof pileGame;
    const s = timeoutPlayer(plain, startSession(plain, ctx), 'alice');
    expect(sessionResult(plain, s)).toEqual({ status: 'win', winner: 'bob', reason: 'timeout' });
  });

  it('forfeit ends the game once and ignores strangers', () => {
    const s = startSession(pileGame, ctx);
    expect(forfeit(pileGame, s, 'eve')).toBe(s);
    const f = forfeit(pileGame, s, 'bob');
    expect(sessionResult(pileGame, f)).toEqual({
      status: 'win',
      winner: 'alice',
      reason: 'forfeit',
    });
    expect(forfeit(pileGame, f, 'alice')).toBe(f);
  });

  it('match cap uses onMatchCap, defaulting to a draw', () => {
    const s = startSession(pileGame, ctx);
    expect(sessionResult(pileGame, applyMatchCap(pileGame, s))).toEqual({
      status: 'win',
      winner: 'bob',
      reason: 'match-cap',
    });
    const { onMatchCap: _drop, ...rest } = pileGame;
    const plain = rest as typeof pileGame;
    const capped = applyMatchCap(plain, startSession(plain, ctx));
    expect(sessionResult(plain, capped)).toEqual({ status: 'draw', reason: 'match-cap' });
    expect(applyMatchCap(plain, capped)).toBe(capped);
  });

  it('replays every event type exactly and rejects illegal logs', () => {
    let s = startSession(pileGame, ctx);
    s = timeoutPlayer(pileGame, s, 'alice');
    const out = submitMove(pileGame, s, 'bob', { take: 2 });
    if (!out.ok) throw new Error(out.reason);
    s = applyMatchCap(pileGame, out.session);
    expect(replaySession(pileGame, ctx, s.events)).toEqual(s);

    const f = forfeit(pileGame, startSession(pileGame, ctx), 'alice');
    expect(replaySession(pileGame, ctx, f.events)).toEqual(f);

    expect(() =>
      replaySession(pileGame, ctx, [{ type: 'move', player: 'bob', move: { take: 1 } }]),
    ).toThrow(/Replay failed at event 0/);
  });
});

describe('registry', () => {
  it('indexes games by id and refuses duplicates', () => {
    expect(createRegistry([pileGame]).get('pile')).toBe(pileGame);
    expect(() => createRegistry([pileGame, pileGame])).toThrow(/Duplicate/);
  });
});

describe('testing helpers', () => {
  it('provides fixed test players and contexts', () => {
    expect(TEST_PLAYERS).toEqual(['alice', 'bob']);
    expect(testContext('x', { bestOf: 3 })).toEqual({
      players: ['alice', 'bob'],
      seed: 'x',
      options: { bestOf: 3 },
    });
  });

  it('deepFreeze freezes nested objects', () => {
    const v = deepFreeze({ a: { b: [1] } });
    expect(Object.isFrozen(v.a.b)).toBe(true);
  });

  it('randomPlaythrough finishes games and needs legalMoves', () => {
    const s = randomPlaythrough(pileGame, testContext('p'), createRng('r'), { timeoutRate: 0.3 });
    expect(isOver(pileGame, s)).toBe(true);
    const { legalMoves: _drop, ...rest } = pileGame;
    expect(() => randomPlaythrough(rest as typeof pileGame, testContext(), createRng('r'))).toThrow(
      /no legalMoves/,
    );
  });

  it('randomPlaythrough reports engines that reject their own legal moves', () => {
    const liar = { ...pileGame, legalMoves: () => [{ take: 3 as 1 }] };
    expect(() => randomPlaythrough(liar, testContext(), createRng('r'))).toThrow(
      /legal move rejected/,
    );
    const stuck = { ...pileGame, legalMoves: () => [] };
    expect(() => randomPlaythrough(stuck, testContext(), createRng('r'))).toThrow(/no legal moves/);
  });

  it('the contract passes for a correct game and catches broken ones', () => {
    checkPluginContract(pileGame, { numRuns: 50 });
    const nondeterministic = {
      ...pileGame,
      init: () => ({ ...pileGame.init(testContext()), r: Math.random() }),
    };
    expect(() => checkPluginContract(nondeterministic, { numRuns: 5 })).toThrow();
    const leaky = { ...pileGame, viewFor: () => ({ pile: 1, fn: undefined }) };
    expect(() => checkPluginContract(leaky, { numRuns: 5 })).toThrow();
    const endless = { ...pileGame, applyMove: (s: PileState) => s };
    expect(() => checkPluginContract(endless, { numRuns: 5, maxSteps: 10 })).toThrow();
  });
});
