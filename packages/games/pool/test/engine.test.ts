import {
  applyMatchCap,
  forfeit,
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
import {
  groupOf,
  judgeShot,
  MAX_SHOTS,
  pool,
  rack,
  remaining,
  takeShot,
  type PoolMove,
  type PoolState,
} from '../src/engine.js';
import { BALL_R, HEAD_SPOT, SUB, type Ball } from '../src/physics.js';

const ctx = testContext('pool-seed');
const MOVE: PoolMove = { angle: 0, power: 50 };

const ball = (id: number, x: number, y: number, on = true): Ball => ({
  id,
  x: x * SUB,
  y: y * SUB,
  on,
});

/** All 16 balls; `on` lists the object balls still on the table (cue is always on). */
function tableWith(on: number[]): Ball[] {
  return Array.from({ length: 16 }, (_, id) =>
    ball(id, 100 + id * 50, id % 2 === 0 ? 100 : 400, id === 0 || on.includes(id)),
  );
}

function stateWith(over: Partial<PoolState> = {}): PoolState {
  return {
    players: ['alice', 'bob'],
    balls: tableWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    turn: 0,
    groups: [null, null],
    pottedBy: [[], []],
    winner: null,
    shots: 1,
    lastShot: null,
    ...over,
  };
}

/** Outcome where `potted` dropped (removed from the table) and the cue hit `first`. */
function outcome(state: PoolState, potted: number[], first: number | null) {
  return {
    balls: state.balls.map((b) => (potted.includes(b.id) ? { ...b, on: false } : b)),
    potted,
    firstContact: first,
  };
}

const solidsVsStripes: PoolState['groups'] = ['solids', 'stripes'];

describe('pool: setup', () => {
  it('racks 15 balls plus the cue, 8 in the middle, mixed back corners, no overlaps', () => {
    for (let i = 0; i < 40; i++) {
      const balls = rack(`rack-${i}`);
      expect(balls.map((b) => b.id)).toEqual([...Array(16).keys()]);
      const apexX = Math.min(...balls.filter((b) => b.id !== 0).map((b) => b.x));
      const rows = [...new Set(balls.filter((b) => b.id !== 0).map((b) => b.x))].sort(
        (a, b) => a - b,
      );
      expect(rows).toHaveLength(5);
      expect(rows[0]).toBe(apexX);
      const eight = balls[8]!;
      expect(eight.x).toBe(rows[2]);
      expect(eight.y).toBe(balls[0]!.y);
      const back = balls.filter((b) => b.x === rows[4]).sort((a, b) => a.y - b.y);
      expect(groupOf(back[0]!.id)).not.toBe(groupOf(back[4]!.id));
      for (const a of balls)
        for (const b of balls)
          if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * BALL_R * SUB);
    }
  });

  it('picks the breaker from the seed, deterministically, and both seats can break', () => {
    const breakers = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const a = startSession(pool, testContext(`seed-${i}`));
      const b = startSession(pool, testContext(`seed-${i}`));
      expect(a.state).toEqual(b.state);
      breakers.add(waitingOn(pool, a)[0]!);
    }
    expect(breakers).toEqual(new Set(['alice', 'bob']));
  });

  it('starts open with the cue ball on the head spot', () => {
    const s = startSession(pool, ctx);
    expect(s.state.groups).toEqual([null, null]);
    expect(s.state.balls[0]).toMatchObject({ x: HEAD_SPOT.x, y: HEAD_SPOT.y, on: true });
    expect(sessionResult(pool, s)).toEqual({ status: 'ongoing' });
  });

  it('rejects anything but exactly two players', () => {
    expect(() => pool.init({ players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => pool.init({ players: ['a', 'b', 'c'], seed: 's' })).toThrow(RangeError);
  });

  it('declares its timers', () => {
    expect(pool.turnModel).toBe('alternating');
    expect(pool.defaultTurnSeconds).toBe(60);
    expect(pool.maxMatchSeconds).toBe(1800);
  });

  it('classifies balls', () => {
    expect([0, 1, 7, 8, 9, 15].map(groupOf)).toEqual([
      null,
      'solids',
      'solids',
      null,
      'stripes',
      'stripes',
    ]);
  });
});

describe('pool: rules', () => {
  it('the first legally potted ball assigns groups to the shooter, who keeps the turn', () => {
    const s = stateWith({ turn: 1 });
    const next = judgeShot(s, MOVE, outcome(s, [11], 3));
    expect(next.groups).toEqual(['solids', 'stripes']);
    expect(next.turn).toBe(1);
    expect(next.pottedBy).toEqual([[], [11]]);
    expect(next.lastShot).toMatchObject({ by: 1, potted: [11], firstContact: 3, foul: null });
  });

  it('assignment works for seat 0 too, and uses the first object ball dropped', () => {
    const s = stateWith();
    const next = judgeShot(s, MOVE, outcome(s, [2, 12], 2));
    expect(next.groups).toEqual(['solids', 'stripes']);
    expect(next.turn).toBe(0);
  });

  it('an open-table shot that pots nothing passes the turn and keeps the table open', () => {
    const s = stateWith();
    const next = judgeShot(s, MOVE, outcome(s, [], 5));
    expect(next.groups).toEqual([null, null]);
    expect(next.turn).toBe(1);
    expect(next.shots).toBe(2);
    expect(next.lastShot!.foul).toBeNull();
  });

  it('hitting the 8 first on an open table is a foul and assigns nothing', () => {
    const s = stateWith();
    const next = judgeShot(s, MOVE, outcome(s, [3], 8));
    expect(next.lastShot!.foul).toBe('wrong-ball');
    expect(next.groups).toEqual([null, null]);
    expect(next.turn).toBe(1);
  });

  it('potting your own group keeps the turn', () => {
    const s = stateWith({ groups: solidsVsStripes });
    const next = judgeShot(s, MOVE, outcome(s, [4], 4));
    expect(next.turn).toBe(0);
    expect(next.pottedBy[0]).toEqual([4]);
  });

  it('potting only the opponent’s ball passes the turn', () => {
    const s = stateWith({ groups: solidsVsStripes });
    const next = judgeShot(s, MOVE, outcome(s, [12], 4));
    expect(next.turn).toBe(1);
    expect(next.lastShot!.foul).toBeNull();
    expect(next.pottedBy[0]).toEqual([12]);
  });

  it('hitting the opponent’s ball first is a foul even if yours drops', () => {
    const s = stateWith({ groups: solidsVsStripes });
    const next = judgeShot(s, MOVE, outcome(s, [4], 12));
    expect(next.lastShot!.foul).toBe('wrong-ball');
    expect(next.turn).toBe(1);
  });

  it('hitting nothing is a foul', () => {
    const s = stateWith({ groups: solidsVsStripes });
    const next = judgeShot(s, MOVE, outcome(s, [], null));
    expect(next.lastShot!.foul).toBe('no-contact');
    expect(next.turn).toBe(1);
  });

  it('a scratch passes the turn, assigns nothing and respawns the cue at the head spot', () => {
    const s = stateWith();
    const next = judgeShot(s, MOVE, outcome(s, [0, 3], 3));
    expect(next.lastShot!.foul).toBe('scratch');
    expect(next.groups).toEqual([null, null]);
    expect(next.turn).toBe(1);
    expect(next.balls[0]).toEqual({ id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, on: true });
  });

  it('the respawned cue ball avoids a ball sitting on the head spot', () => {
    const balls = tableWith([1, 2, 3, 9]).map((b) =>
      b.id === 1 ? { ...b, x: HEAD_SPOT.x, y: HEAD_SPOT.y } : b,
    );
    const s = stateWith({ balls });
    const next = judgeShot(s, MOVE, outcome(s, [0], 1));
    const cue = next.balls[0]!;
    expect(cue.on).toBe(true);
    expect(cue.y).toBe(HEAD_SPOT.y);
    expect(HEAD_SPOT.x - cue.x).toBeGreaterThanOrEqual(2 * BALL_R * SUB);
  });

  it('potting the 8 after clearing your group wins', () => {
    const s = stateWith({ groups: solidsVsStripes, balls: tableWith([8, 9, 10]) });
    expect(remaining(s.balls, 'solids')).toBe(0);
    const next = judgeShot(s, MOVE, outcome(s, [8], 8));
    expect(next.winner).toBe(0);
    expect(pool.getResult(next)).toEqual({ status: 'win', winner: 'alice', reason: 'normal' });
    expect(pool.activePlayers(next)).toEqual([]);
  });

  it('with your group cleared the 8 is your target: hitting a stripe first is a foul', () => {
    const s = stateWith({ groups: solidsVsStripes, balls: tableWith([8, 9, 10]) });
    const next = judgeShot(s, MOVE, outcome(s, [], 9));
    expect(next.lastShot!.foul).toBe('wrong-ball');
    expect(next.turn).toBe(1);
  });

  it('potting the 8 early loses', () => {
    const s = stateWith({ groups: solidsVsStripes });
    const next = judgeShot(s, MOVE, outcome(s, [8], 8));
    expect(next.winner).toBe(1);
    expect(pool.getResult(next)).toMatchObject({ status: 'win', winner: 'bob' });
  });

  it('potting the 8 on an open table (e.g. the break) loses', () => {
    const s = stateWith({ shots: 0, turn: 1 });
    const next = judgeShot(s, MOVE, outcome(s, [3, 8], 3));
    expect(next.winner).toBe(0);
  });

  it('scratching while potting the 8 loses, even with your group cleared', () => {
    const s = stateWith({ groups: solidsVsStripes, balls: tableWith([8, 9]) });
    const next = judgeShot(s, MOVE, outcome(s, [8, 0], 8));
    expect(next.winner).toBe(1);
  });

  it('potting your last group ball and the 8 in the same shot loses (8 was early)', () => {
    const s = stateWith({ groups: solidsVsStripes, balls: tableWith([7, 8, 9]) });
    const next = judgeShot(s, MOVE, outcome(s, [7, 8], 7));
    expect(next.winner).toBe(1);
  });

  it('after the shot cap, fewer group balls left wins; equal is a draw', () => {
    const capped = stateWith({
      groups: solidsVsStripes,
      shots: MAX_SHOTS,
      balls: tableWith([1, 8, 9, 10]),
    });
    expect(pool.getResult(capped)).toEqual({ status: 'win', winner: 'alice', reason: 'normal' });
    expect(pool.getResult({ ...capped, groups: ['stripes', 'solids'] })).toMatchObject({
      winner: 'bob',
    });
    expect(pool.getResult({ ...capped, balls: tableWith([1, 8, 9]) })).toEqual({
      status: 'draw',
      reason: 'normal',
    });
    expect(pool.getResult({ ...capped, groups: [null, null] })).toEqual({
      status: 'draw',
      reason: 'normal',
    });
    expect(pool.activePlayers(capped)).toEqual([]);
  });
});

describe('pool: real shots through the physics', () => {
  it('a straight corner shot assigns the group and keeps the turn', () => {
    const balls = tableWith([]).map((b) =>
      b.id === 0 ? ball(0, 800, 300) : b.id === 3 ? ball(3, 900, 400) : b,
    );
    const next = takeShot(stateWith({ balls }), { angle: 45000, power: 50 });
    expect(next.lastShot).toMatchObject({ potted: [3], firstContact: 3, foul: null });
    expect(next.groups).toEqual(['solids', 'stripes']);
    expect(next.turn).toBe(0);
  });

  it('a cue ball shot straight into a side pocket is a scratch', () => {
    const balls = tableWith([1]).map((b) => (b.id === 0 ? ball(0, 500, 250) : b));
    const next = takeShot(stateWith({ balls }), { angle: 270000, power: 40 });
    expect(next.lastShot!.foul).toBe('scratch');
    expect(next.balls[0]).toMatchObject({ x: HEAD_SPOT.x, on: true });
  });
});

/** Play moves in order, from whoever is to shoot. */
function play(moves: PoolMove[], seed = 'pool-seed'): GameSession<PoolState> {
  let session = startSession(pool, testContext(seed));
  for (const move of moves) {
    const [player] = waitingOn(pool, session);
    if (!player) throw new Error('game already over');
    const outcome = submitMove(pool, session, player, move);
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session;
}

const SHOTS: PoolMove[] = [
  { angle: 0, power: 100 },
  { angle: 123456, power: 40 },
  { angle: 300000, power: 75 },
  { angle: 45000, power: 20 },
  { angle: 210000, power: 90 },
];

describe('pool: determinism', () => {
  it('same seed + moves gives byte-identical state and views, run twice', () => {
    const a = play(SHOTS);
    const b = play(SHOTS);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(pool.viewFor(a.state, 'alice'))).toBe(
      JSON.stringify(pool.viewFor(b.state, 'alice')),
    );
    expect(replaySession(pool, ctx, a.events)).toEqual(a);
  });

  it('never mutates the previous state', () => {
    const s = startSession(pool, ctx);
    deepFreeze(s.state);
    const [p] = waitingOn(pool, s);
    expect(submitMove(pool, s, p!, { angle: 0, power: 100 }).ok).toBe(true);
  });
});

describe('pool: illegal moves', () => {
  const s = startSession(pool, ctx);
  const shooter = waitingOn(pool, s)[0]!;
  const otherPlayer = shooter === 'alice' ? 'bob' : 'alice';

  it.each([
    ['null', null],
    ['string', 'shoot'],
    ['missing power', { angle: 0 }],
    ['negative angle', { angle: -1, power: 50 }],
    ['angle too big', { angle: 360000, power: 50 }],
    ['zero power', { angle: 0, power: 0 }],
    ['power too big', { angle: 0, power: 101 }],
    ['fraction', { angle: 1.5, power: 50 }],
    ['extra keys', { angle: 0, power: 50, spin: 1 }],
    ['array', [0, 50]],
  ])('rejects %s input', (_name, move) => {
    expect(submitMove(pool, s, shooter, move)).toMatchObject({ ok: false });
  });

  it('rejects shooting out of turn and strangers', () => {
    expect(submitMove(pool, s, otherPlayer, MOVE)).toEqual({ ok: false, reason: 'Not your turn' });
    expect(pool.validateMove(s.state, 'mallory', MOVE)).toEqual({
      invalid: true,
      reason: 'Not a player in this game',
    });
  });

  it('rejects moves once the game is over', () => {
    const over = stateWith({ winner: 0 });
    expect(pool.validateMove(over, 'alice', MOVE)).toMatchObject({ reason: 'Game is over' });
    expect(pool.legalMoves!(over, 'alice')).toEqual([]);
  });

  it('accepts the extremes', () => {
    expect(pool.validateMove(s.state, shooter, { angle: 359999, power: 1 })).toEqual({
      angle: 359999,
      power: 1,
    });
  });
});

describe('pool: views, timers and caps', () => {
  it('views show groups, turn, the viewer and no replay before the first shot', () => {
    const s = startSession(pool, ctx);
    const v = pool.viewFor(s.state, 'alice');
    expect(v.balls).toHaveLength(16);
    expect(v.groups).toEqual({ alice: null, bob: null });
    expect(v.potted).toEqual({ alice: [], bob: [] });
    expect(v.turn).toBe(waitingOn(pool, s)[0]);
    expect(v.you).toBe('alice');
    expect(v.lastShot).toBeNull();
    expect(v.table).toMatchObject({ width: 1000, height: 500, ballRadius: BALL_R });
    expect(v.table.pockets).toHaveLength(6);
    expect(pool.viewFor(s.state, null).you).toBeNull();
    expect(pool.viewFor(s.state, 'mallory').you).toBeNull();
  });

  it('after a shot the view carries replay frames that end at the current positions', () => {
    const s = play([{ angle: 0, power: 100 }]);
    const v = pool.viewFor(s.state, 'bob');
    expect(v.lastShot).not.toBeNull();
    expect(v.lastShot!.shot).toBe(1);
    expect(v.lastShot!.frames.length).toBeGreaterThan(2);
    const final = v.lastShot!.frames.at(-1)!;
    for (const b of v.balls) {
      expect(final[b.id * 2]).toBe(b.x);
      expect(final[b.id * 2 + 1]).toBe(b.y);
    }
  });

  it('views of a won game show the winner and nobody to move', () => {
    const won = stateWith({ winner: 1, groups: solidsVsStripes });
    const v = pool.viewFor(won, 'alice');
    expect(v.winner).toBe('bob');
    expect(v.turn).toBeNull();
    expect(v.groups).toEqual({ alice: 'solids', bob: 'stripes' });
  });

  it('legal moves aim at every object ball, only for the shooter', () => {
    const s = startSession(pool, ctx);
    const [shooter] = waitingOn(pool, s);
    const moves = pool.legalMoves!(s.state, shooter!);
    expect(moves.length).toBe(15 * 2 + 4);
    for (const m of moves) expect(pool.validateMove(s.state, shooter!, m)).toEqual(m);
    const other = shooter === 'alice' ? 'bob' : 'alice';
    expect(pool.legalMoves!(s.state, other)).toEqual([]);
  });

  it('a turn timeout forfeits the game to the opponent', () => {
    const s = startSession(pool, ctx);
    const [shooter] = waitingOn(pool, s);
    expect(sessionResult(pool, timeoutPlayer(pool, s, shooter!))).toEqual({
      status: 'win',
      winner: shooter === 'alice' ? 'bob' : 'alice',
      reason: 'timeout',
    });
  });

  it('disconnect forfeit ends the game', () => {
    const s = startSession(pool, ctx);
    expect(sessionResult(pool, forfeit(pool, s, 'alice'))).toMatchObject({
      status: 'win',
      winner: 'bob',
      reason: 'forfeit',
    });
  });

  it('match cap: fewer group balls left wins, open table is a draw', () => {
    const s = startSession(pool, ctx);
    expect(sessionResult(pool, applyMatchCap(pool, s))).toEqual({
      status: 'draw',
      reason: 'match-cap',
    });
    const ahead = stateWith({ groups: solidsVsStripes, balls: tableWith([1, 8, 9, 10, 11]) });
    expect(pool.onMatchCap!(ahead)).toEqual({
      status: 'win',
      winner: 'alice',
      reason: 'match-cap',
    });
  });
});

describe('pool: plug-in contract (property-based)', () => {
  it('satisfies the game-sdk contract', () => {
    checkPluginContract(pool, { numRuns: 40, maxSteps: MAX_SHOTS + 10 });
  }, 120_000);
});
