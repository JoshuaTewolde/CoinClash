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
import { LINES, ticTacToe, type TicTacToeState } from '../src/engine.js';

const ctx = testContext('ttt-seed');

/** Start a session and play cells in order, alternating from whoever moves first. */
function play(cells: number[], seed = 'ttt-seed'): GameSession<TicTacToeState> {
  let session = startSession(ticTacToe, testContext(seed));
  for (const cell of cells) {
    const [player] = waitingOn(ticTacToe, session);
    if (!player) throw new Error('game already over');
    const outcome = submitMove(ticTacToe, session, player, { cell });
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session;
}

function firstMover(session: GameSession<TicTacToeState>): string {
  return session.state.players[session.state.xSeat];
}

describe('tic-tac-toe: setup', () => {
  it('starts empty with X to move', () => {
    const s = startSession(ticTacToe, ctx);
    expect(s.state.board).toEqual(Array(9).fill(null));
    expect(waitingOn(ticTacToe, s)).toEqual([firstMover(s)]);
    expect(ticTacToe.viewFor(s.state, firstMover(s)).you).toBe('X');
  });

  it('picks the first player from the seed, deterministically, and both seats can start', () => {
    const starters = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const a = startSession(ticTacToe, testContext(`seed-${i}`));
      const b = startSession(ticTacToe, testContext(`seed-${i}`));
      expect(firstMover(a)).toBe(firstMover(b));
      starters.add(firstMover(a));
    }
    expect(starters).toEqual(new Set(['alice', 'bob']));
  });

  it('rejects anything but exactly two players', () => {
    expect(() => ticTacToe.init({ players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => ticTacToe.init({ players: ['a', 'b', 'c'], seed: 's' })).toThrow(RangeError);
  });

  it('declares its timers', () => {
    expect(ticTacToe.turnModel).toBe('alternating');
    expect(ticTacToe.maxMatchSeconds).toBeGreaterThanOrEqual(9 * ticTacToe.defaultTurnSeconds);
  });
});

describe('tic-tac-toe: wins', () => {
  // For each line, X plays the line while O plays two cells off the line.
  it.each(LINES.map((line) => [line.join('-'), line] as const))(
    'X wins on line %s',
    (_name, line) => {
      const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c));
      // O's cells must not themselves form a line before X completes; pick two non-colinear ones.
      const oCells = others.slice(0, 2);
      const s = play([line[0], oCells[0]!, line[1], oCells[1]!, line[2]]);
      const result = sessionResult(ticTacToe, s);
      expect(result).toEqual({ status: 'win', winner: firstMover(s), reason: 'normal' });
      expect(ticTacToe.viewFor(s.state, null).winningLine).toEqual(line);
      expect(waitingOn(ticTacToe, s)).toEqual([]);
    },
  );

  it.each(LINES.map((line) => [line.join('-'), line] as const))(
    'O wins on line %s',
    (_name, line) => {
      const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c));
      // X needs three cells that don't make a line; try combinations until one works.
      const combos: number[][] = [];
      for (let i = 0; i < others.length; i++)
        for (let j = i + 1; j < others.length; j++)
          for (let k = j + 1; k < others.length; k++)
            combos.push([others[i]!, others[j]!, others[k]!]);
      const x = combos.find((c) => !LINES.some((l) => l.every((cell) => c.includes(cell))))!;
      const s = play([x[0]!, line[0], x[1]!, line[1], x[2]!, line[2]]);
      const oPlayer = s.state.players[s.state.xSeat === 0 ? 1 : 0];
      expect(sessionResult(ticTacToe, s)).toEqual({
        status: 'win',
        winner: oPlayer,
        reason: 'normal',
      });
    },
  );
});

describe('tic-tac-toe: draw', () => {
  it('is a draw on a full board with no line', () => {
    // X O X / X O O / O X X
    const s = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(sessionResult(ticTacToe, s)).toEqual({ status: 'draw', reason: 'normal' });
    expect(ticTacToe.viewFor(s.state, 'alice').turn).toBeNull();
  });

  it('a win on the ninth move beats the full-board draw', () => {
    // Final board: X X X / O O X / X O O. X's ninth move at 2 completes the top row.
    const s = play([0, 3, 1, 4, 5, 7, 6, 8, 2]);
    expect(s.state.board.every((c) => c !== null)).toBe(true);
    expect(sessionResult(ticTacToe, s)).toEqual({
      status: 'win',
      winner: firstMover(s),
      reason: 'normal',
    });
  });
});

describe('tic-tac-toe: illegal moves', () => {
  const s = startSession(ticTacToe, ctx);
  const x = firstMover(s);
  const o = x === 'alice' ? 'bob' : 'alice';

  it.each([
    ['null', null],
    ['string', '4'],
    ['negative', { cell: -1 }],
    ['too big', { cell: 9 }],
    ['fraction', { cell: 1.5 }],
    ['extra keys', { cell: 1, hack: true }],
    ['array', [4]],
  ])('rejects %s input', (_name, move) => {
    expect(submitMove(ticTacToe, s, x, move)).toMatchObject({ ok: false });
  });

  it('rejects moving out of turn', () => {
    expect(submitMove(ticTacToe, s, o, { cell: 0 })).toEqual({
      ok: false,
      reason: 'Not your turn',
    });
    expect(ticTacToe.validateMove(s.state, o, { cell: 0 })).toMatchObject({ invalid: true });
  });

  it('rejects strangers', () => {
    expect(submitMove(ticTacToe, s, 'mallory', { cell: 0 })).toMatchObject({ ok: false });
    expect(ticTacToe.validateMove(s.state, 'mallory', { cell: 0 })).toMatchObject({
      invalid: true,
      reason: 'Not a player in this game',
    });
  });

  it('rejects an occupied cell', () => {
    const after = play([4]);
    const [next] = waitingOn(ticTacToe, after);
    expect(submitMove(ticTacToe, after, next!, { cell: 4 })).toEqual({
      ok: false,
      reason: 'Cell is already taken',
    });
  });

  it('rejects moves after the game ends', () => {
    const won = play([0, 3, 1, 4, 2]);
    expect(ticTacToe.validateMove(won.state, firstMover(won), { cell: 8 })).toMatchObject({
      reason: 'Game is over',
    });
    expect(ticTacToe.legalMoves!(won.state, firstMover(won))).toEqual([]);
  });
});

describe('tic-tac-toe: purity, views and timers', () => {
  it('never mutates the previous state', () => {
    const s = startSession(ticTacToe, ctx);
    deepFreeze(s.state);
    const next = submitMove(ticTacToe, s, firstMover(s), { cell: 0 });
    expect(next.ok).toBe(true);
    expect(s.state.board[0]).toBeNull();
  });

  it('views show marks, turn and the viewer', () => {
    const s = play([4]);
    const x = firstMover(s);
    const o = x === 'alice' ? 'bob' : 'alice';
    const view = ticTacToe.viewFor(s.state, o);
    expect(view.board[4]).toBe('X');
    expect(view.marks).toEqual({ [x]: 'X', [o]: 'O' });
    expect(view.turn).toBe(o);
    expect(view.you).toBe('O');
    expect(ticTacToe.viewFor(s.state, null).you).toBeNull();
    expect(ticTacToe.viewFor(s.state, 'mallory').you).toBeNull();
  });

  it('lists only empty cells as legal, and only for the player to move', () => {
    const s = play([0, 4]);
    const [next] = waitingOn(ticTacToe, s);
    const other = next === 'alice' ? 'bob' : 'alice';
    expect(ticTacToe.legalMoves!(s.state, next!).map((m) => m.cell)).toEqual([1, 2, 3, 5, 6, 7, 8]);
    expect(ticTacToe.legalMoves!(s.state, other)).toEqual([]);
  });

  it('a turn timeout forfeits the game to the opponent', () => {
    const s = startSession(ticTacToe, ctx);
    const x = firstMover(s);
    const timedOut = timeoutPlayer(ticTacToe, s, x);
    expect(sessionResult(ticTacToe, timedOut)).toEqual({
      status: 'win',
      winner: x === 'alice' ? 'bob' : 'alice',
      reason: 'timeout',
    });
  });

  it('disconnect forfeit and match cap end the game', () => {
    const s = play([4]);
    expect(sessionResult(ticTacToe, forfeit(ticTacToe, s, 'alice'))).toMatchObject({
      status: 'win',
      winner: 'bob',
      reason: 'forfeit',
    });
    expect(sessionResult(ticTacToe, applyMatchCap(ticTacToe, s))).toEqual({
      status: 'draw',
      reason: 'match-cap',
    });
  });

  it('replays a recorded game exactly', () => {
    const s = play([4, 0, 8, 2, 1]);
    const replayed = replaySession(ticTacToe, ctx, s.events);
    expect(replayed).toEqual(s);
  });
});

describe('tic-tac-toe: plug-in contract (property-based)', () => {
  it('satisfies the game-sdk contract', () => {
    checkPluginContract(ticTacToe, { numRuns: 300, maxSteps: 20 });
  });
});
