import {
  applyMatchCap,
  isInvalid,
  replaySession,
  sessionResult,
  startSession,
  submitMove,
  timeoutPlayer,
  waitingOn,
  type GameSession,
} from '@coinclash/game-sdk';
import { checkPluginContract, deepFreeze, testContext } from '@coinclash/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { PICKS, rps, type Pick, type RpsState } from '../src/engine.js';

const A = 'alice';
const B = 'bob';

function start(options?: unknown): GameSession<RpsState> {
  return startSession(rps, testContext('rps-seed', options));
}

function move(s: GameSession<RpsState>, player: string, pick: unknown): GameSession<RpsState> {
  const out = submitMove(rps, s, player, { pick });
  if (!out.ok) throw new Error(out.reason);
  return out.session;
}

/** Play full rounds: each entry is [alice's pick, bob's pick]. */
function rounds(pairs: [Pick, Pick][], s = start()): GameSession<RpsState> {
  for (const [a, b] of pairs) s = move(move(s, A, a), B, b);
  return s;
}

describe('rps: setup', () => {
  it('starts with both players active and nothing played', () => {
    const s = start();
    expect(waitingOn(rps, s)).toEqual([A, B]);
    expect(s.state.wins).toEqual([0, 0]);
    expect(s.state.bestOf).toBe(3);
    const v = rps.viewFor(s.state, A);
    expect(v.round).toBe(1);
    expect(v.winsNeeded).toBe(2);
    expect(v.maxRounds).toBe(9);
    expect(v.picked).toEqual({ [A]: false, [B]: false });
  });

  it('declares a simultaneous turn model and real timers', () => {
    expect(rps.turnModel).toBe('simultaneous');
    expect(rps.defaultTurnSeconds).toBe(30);
    // The cap must cover the longest possible match (15 rounds of best of 5).
    expect(rps.maxMatchSeconds).toBeGreaterThanOrEqual(15 * rps.defaultTurnSeconds);
  });

  it('rejects anything but exactly two players', () => {
    expect(() => rps.init({ players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => rps.init({ players: ['a', 'b', 'c'], seed: 's' })).toThrow(RangeError);
  });

  it('parses best-of options strictly', () => {
    expect(rps.parseOptions!({ bestOf: 5 })).toEqual({ bestOf: 5 });
    expect(rps.parseOptions!({ bestOf: 3 })).toEqual({ bestOf: 3 });
    expect(isInvalid(rps.parseOptions!({ bestOf: 4 }))).toBe(true);
    expect(isInvalid(rps.parseOptions!({ bestOf: 3, x: 1 }))).toBe(true);
    expect(isInvalid(rps.parseOptions!('3'))).toBe(true);
    // Stored options may be null (no options chosen): default best of 3.
    expect(rps.init({ players: [A, B], seed: 's', options: null }).bestOf).toBe(3);
  });
});

describe('rps: rounds', () => {
  const beats: Record<Pick, Pick> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  for (const a of PICKS) {
    for (const b of PICKS) {
      const expected = a === b ? null : beats[a] === b ? A : B;
      it(`${a} vs ${b} → ${expected ?? 'drawn round'}`, () => {
        const s = rounds([[a, b]]);
        expect(s.state.history).toHaveLength(1);
        const round = rps.viewFor(s.state, A).history[0]!;
        expect(round.winner).toBe(expected);
        expect(round.picks).toEqual({ [A]: a, [B]: b });
        expect(rps.viewFor(s.state, A).score).toEqual({
          [A]: expected === A ? 1 : 0,
          [B]: expected === B ? 1 : 0,
        });
        // Either way a new round begins with both players active.
        expect(waitingOn(rps, s)).toEqual([A, B]);
        expect(s.state.current).toEqual([null, null]);
      });
    }
  }

  it('waits only on the player who has not picked, in either order', () => {
    const s1 = move(start(), B, 'rock');
    expect(waitingOn(rps, s1)).toEqual([A]);
    const s2 = move(start(), A, 'rock');
    expect(waitingOn(rps, s2)).toEqual([B]);
  });

  it('replays a drawn round and the match continues', () => {
    const s = rounds([
      ['rock', 'rock'],
      ['paper', 'paper'],
    ]);
    expect(s.state.history).toHaveLength(2);
    expect(s.state.wins).toEqual([0, 0]);
    expect(rps.viewFor(s.state, B).round).toBe(3);
    expect(sessionResult(rps, s)).toEqual({ status: 'ongoing' });
  });
});

describe('rps: winning the match', () => {
  it('first to 2 round wins takes a best of 3', () => {
    const s = rounds([
      ['rock', 'scissors'],
      ['rock', 'paper'],
      ['rock', 'rock'],
      ['paper', 'rock'],
    ]);
    expect(sessionResult(rps, s)).toEqual({ status: 'win', winner: A, reason: 'normal' });
    expect(waitingOn(rps, s)).toEqual([]);
    const v = rps.viewFor(s.state, B);
    expect(v.over).toBe(true);
    expect(v.winner).toBe(A);
    expect(v.round).toBe(4);
    expect(v.score).toEqual({ [A]: 2, [B]: 1 });
  });

  it('bob can win too, 2-0', () => {
    const s = rounds([
      ['rock', 'paper'],
      ['scissors', 'rock'],
    ]);
    expect(sessionResult(rps, s)).toEqual({ status: 'win', winner: B, reason: 'normal' });
  });

  it('best of 5 needs 3 round wins', () => {
    const s = rounds(
      [
        ['rock', 'scissors'],
        ['rock', 'scissors'],
      ],
      start({ bestOf: 5 }),
    );
    expect(sessionResult(rps, s).status).toBe('ongoing');
    const done = rounds([['rock', 'scissors']], s);
    expect(sessionResult(rps, done)).toEqual({ status: 'win', winner: A, reason: 'normal' });
  });

  it('is a draw after 9 rounds without a winner', () => {
    const eightDraws = Array.from({ length: 8 }, (): [Pick, Pick] => ['rock', 'rock']);
    let s = rounds([['rock', 'scissors'], ...eightDraws.slice(0, 7)]);
    // 8 rounds: alice leads 1-0, still ongoing.
    expect(s.state.history).toHaveLength(8);
    expect(sessionResult(rps, s).status).toBe('ongoing');
    s = rounds([['paper', 'scissors']], s);
    // Round 9: bob wins it → 1-1 at the cap.
    expect(sessionResult(rps, s)).toEqual({ status: 'draw', reason: 'normal' });
    expect(waitingOn(rps, s)).toEqual([]);
    expect(rps.viewFor(s.state, A).winner).toBeNull();
  });

  it('a winning 9th round still wins', () => {
    const draws = Array.from({ length: 7 }, (): [Pick, Pick] => ['paper', 'paper']);
    const s = rounds([['rock', 'scissors'], ...draws, ['scissors', 'paper']]);
    expect(s.state.history).toHaveLength(9);
    expect(sessionResult(rps, s)).toEqual({ status: 'win', winner: A, reason: 'normal' });
  });
});

describe('rps: invalid moves', () => {
  it('rejects picking twice in a round', () => {
    const s = move(start(), A, 'rock');
    const again = submitMove(rps, s, A, { pick: 'paper' });
    expect(again.ok).toBe(false);
    // validateMove directly also refuses, with a clear reason.
    const direct = rps.validateMove(s.state, A, { pick: 'paper' });
    expect(direct).toEqual({ invalid: true, reason: 'You already picked this round' });
  });

  it('rejects malformed moves', () => {
    const s = start();
    for (const bad of [
      null,
      undefined,
      'rock',
      {},
      { pick: 'lizard' },
      { pick: 'ROCK' },
      { pick: 'rock', extra: 1 },
      { cell: 0 },
    ]) {
      expect(isInvalid(rps.validateMove(s.state, A, bad))).toBe(true);
    }
  });

  it('rejects strangers and moves after the match is over', () => {
    const s = start();
    expect(rps.validateMove(s.state, 'mallory', { pick: 'rock' })).toEqual({
      invalid: true,
      reason: 'Not a player in this game',
    });
    expect(rps.applyMove(s.state, 'mallory', { pick: 'rock' })).toBe(s.state);
    expect(rps.legalMoves!(s.state, 'mallory')).toEqual([]);
    const done = rounds([
      ['rock', 'scissors'],
      ['rock', 'scissors'],
    ]);
    expect(rps.validateMove(done.state, B, { pick: 'rock' })).toEqual({
      invalid: true,
      reason: 'Game is over',
    });
    expect(rps.legalMoves!(done.state, B)).toEqual([]);
  });

  it('offers all three picks only to players who still need to pick', () => {
    const s = move(start(), A, 'rock');
    expect(rps.legalMoves!(s.state, A)).toEqual([]);
    expect(rps.legalMoves!(s.state, B)).toEqual(PICKS.map((pick) => ({ pick })));
  });

  it('never mutates state', () => {
    const s = start();
    deepFreeze(s.state);
    const s1 = move(s, A, 'rock');
    deepFreeze(s1.state);
    const s2 = move(s1, B, 'paper');
    deepFreeze(s2.state);
    expect(rps.onTimeout!(s2.state, A)).not.toBe(s2.state);
    expect(s.state.current).toEqual([null, null]);
  });
});

describe('rps: timeouts', () => {
  it('a player who did not pick loses the round, not the match', () => {
    const s = timeoutPlayer(rps, move(start(), A, 'rock'), B);
    expect(s.override).toBeNull();
    expect(s.state.wins).toEqual([1, 0]);
    const round = rps.viewFor(s.state, A).history[0]!;
    expect(round).toEqual({
      round: 1,
      picks: { [A]: 'rock', [B]: null },
      winner: A,
      timedOut: [B],
    });
    expect(waitingOn(rps, s)).toEqual([A, B]);
  });

  it('if neither picked the round is drawn and replayed', () => {
    let s = start();
    // The server times out everyone it waits on in one tick, one player at a time.
    for (const p of waitingOn(rps, s)) s = timeoutPlayer(rps, s, p);
    expect(s.override).toBeNull();
    expect(s.state.history).toEqual([{ picks: [null, null], winner: null }]);
    expect(s.state.wins).toEqual([0, 0]);
    expect(rps.viewFor(s.state, A).history[0]!.timedOut).toEqual([A, B]);
    // Next round: both active again, and the first timeout didn't leak into it.
    expect(waitingOn(rps, s)).toEqual([A, B]);
  });

  it('a timed-out player is no longer waited on; the other can still pick and win', () => {
    let s = timeoutPlayer(rps, start(), A);
    expect(waitingOn(rps, s)).toEqual([B]);
    expect(rps.viewFor(s.state, B).picked[A]).toBe(true);
    expect(rps.viewFor(s.state, A).yourPick).toBeNull();
    s = move(s, B, 'paper');
    expect(s.state.wins).toEqual([0, 1]);
  });

  it('timing out a player who already picked (or a stranger) changes nothing', () => {
    const s = move(start(), A, 'rock');
    expect(rps.onTimeout!(s.state, A)).toBe(s.state);
    expect(rps.onTimeout!(s.state, 'mallory')).toBe(s.state);
  });

  it('two timeouts in a row lose the match', () => {
    let s = start();
    for (let i = 0; i < 2; i++) s = timeoutPlayer(rps, move(s, A, 'rock'), B);
    expect(sessionResult(rps, s)).toEqual({ status: 'win', winner: A, reason: 'normal' });
  });
});

describe('rps: match cap', () => {
  it('is a draw when level', () => {
    const s = applyMatchCap(rps, rounds([['rock', 'rock']]));
    expect(sessionResult(rps, s)).toEqual({ status: 'draw', reason: 'match-cap' });
  });

  it('goes to whoever leads on rounds', () => {
    const s = applyMatchCap(rps, rounds([['rock', 'paper']]));
    expect(sessionResult(rps, s)).toEqual({ status: 'win', winner: B, reason: 'match-cap' });
    const s2 = applyMatchCap(rps, rounds([['paper', 'rock']]));
    expect(sessionResult(rps, s2)).toEqual({ status: 'win', winner: A, reason: 'match-cap' });
  });
});

describe('rps: viewFor never leaks the current pick', () => {
  const histories: [Pick, Pick][][] = [
    [],
    [['rock', 'rock']],
    [['paper', 'scissors']],
    [
      ['scissors', 'rock'],
      ['paper', 'paper'],
    ],
  ];
  const seats = [
    [A, B],
    [B, A],
  ] as const;

  /** Every "one player has picked" position over a few different histories. */
  function positions(): { s: GameSession<RpsState>; other: string }[] {
    return histories.flatMap((h) =>
      seats.flatMap(([picker, other]) =>
        PICKS.map((pick) => ({ s: move(rounds(h), picker, pick), other })),
      ),
    );
  }

  it('the opponent and observers see the same view whatever was picked', () => {
    for (const h of histories) {
      for (const [picker, other] of seats) {
        const states = PICKS.map((p) => move(rounds(h), picker, p).state);
        for (const viewer of [other, null]) {
          const seen = states.map((st) => JSON.stringify(rps.viewFor(st, viewer)));
          expect(new Set(seen).size).toBe(1);
        }
      }
    }
  });

  it('the pick string never appears in the opponent or observer view in round 1', () => {
    for (const pick of PICKS) {
      for (const [picker, other] of seats) {
        const s = move(start(), picker, pick);
        for (const viewer of [other, null]) {
          const json = JSON.stringify(rps.viewFor(s.state, viewer));
          for (const p of PICKS) expect(json).not.toContain(p);
          expect(rps.viewFor(s.state, viewer).picked[picker]).toBe(true);
        }
        // The picker sees their own pick.
        expect(rps.viewFor(s.state, picker).yourPick).toBe(pick);
      }
    }
  });

  it('only revealed rounds appear in history', () => {
    for (const { s, other } of positions()) {
      const v = rps.viewFor(s.state, other);
      expect(v.history).toHaveLength(s.state.history.length);
      expect(v.yourPick).toBeNull();
    }
  });

  it('reveals both picks once the round completes', () => {
    const s = rounds([['rock', 'paper']]);
    for (const viewer of [A, B, null]) {
      expect(rps.viewFor(s.state, viewer).history[0]!.picks).toEqual({ [A]: 'rock', [B]: 'paper' });
    }
  });
});

describe('rps: plug-in contract', () => {
  it('replays a mixed log exactly', () => {
    let s = move(start(), A, 'rock');
    s = timeoutPlayer(rps, s, B);
    s = move(s, B, 'paper');
    const replayed = replaySession(rps, s.ctx, s.events);
    expect(replayed.state).toEqual(s.state);
  });

  it('satisfies the plug-in contract (best of 3)', () => {
    checkPluginContract(rps, { maxSteps: 200 });
  });

  it('satisfies the plug-in contract (best of 5)', () => {
    checkPluginContract(rps, { maxSteps: 200, numRuns: 100, options: { bestOf: 5 } });
  });
});
