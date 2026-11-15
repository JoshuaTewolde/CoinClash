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
import { COLUMNS, ROWS, connect4, type Connect4State } from '../src/engine.js';

const ctx = testContext('c4-seed');

/** Start a session and drop discs in these columns, alternating from whoever moves first. */
function play(columns: number[], seed = 'c4-seed'): GameSession<Connect4State> {
  let session = startSession(connect4, testContext(seed));
  for (const column of columns) {
    const [player] = waitingOn(connect4, session);
    if (!player) throw new Error('game already over');
    const outcome = submitMove(connect4, session, player, { column });
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session;
}

const firstMover = (s: GameSession<Connect4State>) => s.state.players[s.state.redSeat];
const secondMover = (s: GameSession<Connect4State>) =>
  s.state.players[s.state.redSeat === 0 ? 1 : 0];

describe('connect 4: setup', () => {
  it('starts with an empty 7 × 6 board and red to move', () => {
    const s = startSession(connect4, ctx);
    expect(s.state.board).toEqual(Array(ROWS * COLUMNS).fill(null));
    expect(waitingOn(connect4, s)).toEqual([firstMover(s)]);
    const view = connect4.viewFor(s.state, firstMover(s));
    expect(view.you).toBe('red');
    expect(view.board).toHaveLength(6);
    for (const row of view.board) expect(row).toEqual(Array(7).fill(null));
    expect(view.lastMove).toBeNull();
    expect(view.winningLine).toBeNull();
  });

  it('picks the first player from the seed, deterministically, and both seats can start', () => {
    const starters = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const a = startSession(connect4, testContext(`seed-${i}`));
      const b = startSession(connect4, testContext(`seed-${i}`));
      expect(firstMover(a)).toBe(firstMover(b));
      starters.add(firstMover(a));
    }
    expect(starters).toEqual(new Set(['alice', 'bob']));
  });

  it('rejects anything but exactly two players', () => {
    expect(() => connect4.init({ players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => connect4.init({ players: ['a', 'b', 'c'], seed: 's' })).toThrow(RangeError);
  });

  it('declares its timers', () => {
    expect(connect4.id).toBe('connect4');
    expect(connect4.turnModel).toBe('alternating');
    expect(connect4.defaultTurnSeconds).toBe(60);
    expect(connect4.maxMatchSeconds).toBe(1200);
  });
});

describe('connect 4: gravity', () => {
  it('drops a disc to the lowest empty row and stacks on top', () => {
    const one = play([3]);
    expect(connect4.viewFor(one.state, null).board[5]![3]).toBe('red');
    expect(one.state.lastMove).toEqual({ row: 5, col: 3 });

    const two = play([3, 3]);
    const view = connect4.viewFor(two.state, null);
    expect(view.board[5]![3]).toBe('red');
    expect(view.board[4]![3]).toBe('yellow');
    expect(view.lastMove).toEqual({ row: 4, col: 3 });
  });

  it('fills a column to the top, then rejects it', () => {
    const full = play([0, 0, 0, 0, 0, 0]);
    expect(connect4.viewFor(full.state, null).board.map((r) => r[0])).toEqual([
      'yellow',
      'red',
      'yellow',
      'red',
      'yellow',
      'red',
    ]);
    const [next] = waitingOn(connect4, full);
    expect(submitMove(connect4, full, next!, { column: 0 })).toEqual({
      ok: false,
      reason: 'Column is full',
    });
    expect(connect4.legalMoves!(full.state, next!).map((m) => m.column)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('connect 4: wins', () => {
  it.each([
    [
      'vertical',
      [0, 1, 0, 1, 0, 1, 0],
      [
        { row: 2, col: 0 },
        { row: 3, col: 0 },
        { row: 4, col: 0 },
        { row: 5, col: 0 },
      ],
    ],
    [
      'horizontal',
      [0, 0, 1, 1, 2, 2, 3],
      [
        { row: 5, col: 0 },
        { row: 5, col: 1 },
        { row: 5, col: 2 },
        { row: 5, col: 3 },
      ],
    ],
    [
      'diagonal /',
      [0, 1, 1, 2, 3, 2, 2, 3, 3, 6, 3],
      [
        { row: 2, col: 3 },
        { row: 3, col: 2 },
        { row: 4, col: 1 },
        { row: 5, col: 0 },
      ],
    ],
    [
      'diagonal \\',
      [6, 5, 5, 4, 3, 4, 4, 3, 3, 0, 3],
      [
        { row: 2, col: 3 },
        { row: 3, col: 4 },
        { row: 4, col: 5 },
        { row: 5, col: 6 },
      ],
    ],
  ] as const)('first mover wins %s', (_name, columns, line) => {
    const s = play([...columns]);
    expect(sessionResult(connect4, s)).toEqual({
      status: 'win',
      winner: firstMover(s),
      reason: 'normal',
    });
    const view = connect4.viewFor(s.state, null);
    expect(view.winningLine).toEqual(line);
    expect(view.turn).toBeNull();
    expect(waitingOn(connect4, s)).toEqual([]);
  });

  it('second mover can win too', () => {
    const s = play([0, 1, 0, 1, 2, 1, 3, 1]);
    expect(sessionResult(connect4, s)).toEqual({
      status: 'win',
      winner: secondMover(s),
      reason: 'normal',
    });
  });

  it('highlights all five cells of a five in a row', () => {
    const s = play([0, 0, 1, 1, 2, 2, 4, 4, 3]);
    expect(sessionResult(connect4, s)).toMatchObject({ status: 'win', winner: firstMover(s) });
    expect(connect4.viewFor(s.state, null).winningLine).toEqual(
      [0, 1, 2, 3, 4].map((col) => ({ row: 5, col })),
    );
  });

  it('three in a row is not a win', () => {
    const s = play([0, 0, 1, 1, 2, 2]);
    expect(sessionResult(connect4, s)).toEqual({ status: 'ongoing' });
  });
});

describe('connect 4: draw', () => {
  // A full board with no four in a row (found by random search, verified here).
  const DRAW = [
    1, 0, 2, 0, 5, 2, 2, 6, 6, 3, 5, 2, 1, 3, 6, 1, 2, 6, 3, 2, 3, 4, 6, 5, 4, 5, 0, 5, 3, 4, 0, 4,
    6, 1, 1, 4, 5, 3, 4, 0, 0, 1,
  ];

  it('is a draw on a full board with no four in a row', () => {
    expect(DRAW).toHaveLength(42);
    const s = play(DRAW);
    expect(s.state.board.every((c) => c !== null)).toBe(true);
    expect(sessionResult(connect4, s)).toEqual({ status: 'draw', reason: 'normal' });
    expect(connect4.viewFor(s.state, 'alice').turn).toBeNull();
    expect(connect4.viewFor(s.state, 'alice').winningLine).toBeNull();
    expect(waitingOn(connect4, s)).toEqual([]);
  });
});

describe('connect 4: illegal moves', () => {
  const s = startSession(connect4, ctx);
  const red = firstMover(s);
  const yellow = secondMover(s);

  it.each([
    ['null', null],
    ['string', '3'],
    ['number', 3],
    ['negative', { column: -1 }],
    ['too big', { column: 7 }],
    ['fraction', { column: 1.5 }],
    ['string column', { column: '1' }],
    ['extra keys', { column: 1, row: 5 }],
    ['wrong key', { cell: 1 }],
    ['array', [3]],
  ])('rejects %s input', (_name, move) => {
    expect(submitMove(connect4, s, red, move)).toMatchObject({ ok: false });
    expect(connect4.validateMove(s.state, red, move)).toMatchObject({
      invalid: true,
      reason: 'Move must be { column: 0-6 }',
    });
  });

  it('rejects moving out of turn', () => {
    expect(submitMove(connect4, s, yellow, { column: 0 })).toEqual({
      ok: false,
      reason: 'Not your turn',
    });
    expect(connect4.legalMoves!(s.state, yellow)).toEqual([]);
  });

  it('rejects strangers', () => {
    expect(connect4.validateMove(s.state, 'mallory', { column: 0 })).toEqual({
      invalid: true,
      reason: 'Not a player in this game',
    });
  });

  it('rejects moves after the game ends', () => {
    const won = play([0, 1, 0, 1, 0, 1, 0]);
    expect(connect4.validateMove(won.state, secondMover(won), { column: 2 })).toMatchObject({
      reason: 'Game is over',
    });
    expect(connect4.legalMoves!(won.state, secondMover(won))).toEqual([]);
  });
});

describe('connect 4: purity, views and timers', () => {
  it('never mutates the previous state', () => {
    const s = startSession(connect4, ctx);
    deepFreeze(s.state);
    const next = submitMove(connect4, s, firstMover(s), { column: 0 });
    expect(next.ok).toBe(true);
    expect(s.state.board.every((c) => c === null)).toBe(true);
    expect(s.state.lastMove).toBeNull();
  });

  it('views show colors, turn and the viewer', () => {
    const s = play([3]);
    const red = firstMover(s);
    const yellow = secondMover(s);
    const view = connect4.viewFor(s.state, yellow);
    expect(view.colors).toEqual({ [red]: 'red', [yellow]: 'yellow' });
    expect(view.turn).toBe(yellow);
    expect(view.you).toBe('yellow');
    expect(connect4.viewFor(s.state, red).you).toBe('red');
    expect(connect4.viewFor(s.state, null).you).toBeNull();
    expect(connect4.viewFor(s.state, 'mallory').you).toBeNull();
  });

  it('lists every non-full column as legal for the player to move', () => {
    const s = play([0, 4]);
    const [next] = waitingOn(connect4, s);
    expect(connect4.legalMoves!(s.state, next!).map((m) => m.column)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('a turn timeout forfeits the game to the opponent', () => {
    const s = startSession(connect4, ctx);
    expect(sessionResult(connect4, timeoutPlayer(connect4, s, firstMover(s)))).toEqual({
      status: 'win',
      winner: secondMover(s),
      reason: 'timeout',
    });
  });

  it('disconnect forfeit and match cap end the game', () => {
    const s = play([3]);
    expect(sessionResult(connect4, forfeit(connect4, s, 'alice'))).toMatchObject({
      status: 'win',
      winner: 'bob',
      reason: 'forfeit',
    });
    expect(sessionResult(connect4, applyMatchCap(connect4, s))).toEqual({
      status: 'draw',
      reason: 'match-cap',
    });
  });

  it('replays a recorded game exactly', () => {
    const s = play([3, 3, 4, 2, 5, 6, 1]);
    expect(replaySession(connect4, ctx, s.events)).toEqual(s);
  });
});

describe('connect 4: plug-in contract (property-based)', () => {
  it('satisfies the game-sdk contract', () => {
    checkPluginContract(connect4, { numRuns: 200, maxSteps: 50 });
  });
});
