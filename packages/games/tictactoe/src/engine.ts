import {
  createRng,
  invalid,
  type GamePlugin,
  type GameResult,
  type InvalidMove,
  type PlayerId,
} from '@coinclash/game-sdk';
import { z } from 'zod';

/** Seat index: 0 or 1, the position in `players`. */
export type Seat = 0 | 1;
export type Mark = 'X' | 'O';

export interface TicTacToeState {
  readonly players: readonly [PlayerId, PlayerId];
  /** 9 cells, row-major. Each holds the seat that marked it, or null. */
  readonly board: readonly (Seat | null)[];
  /** Seat that plays X and moves first (chosen from the match seed). */
  readonly xSeat: Seat;
  /** Seat to move next. */
  readonly turn: Seat;
}

export interface TicTacToeMove {
  readonly cell: number;
}

export interface TicTacToeView {
  readonly board: readonly (Mark | null)[];
  readonly marks: Readonly<Record<PlayerId, Mark>>;
  /** Player to move, or null when the game is over. */
  readonly turn: PlayerId | null;
  /** The viewer's mark, or null for observers. */
  readonly you: Mark | null;
  /** Cells of the winning line, if any. */
  readonly winningLine: readonly number[] | null;
}

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const MoveSchema = z.object({ cell: z.number().int().min(0).max(8) }).strict();

function winningLine(
  board: readonly (Seat | null)[],
): { seat: Seat; line: readonly number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const s = board[a];
    if (s !== null && s !== undefined && s === board[b] && s === board[c]) return { seat: s, line };
  }
  return null;
}

function seatOf(state: TicTacToeState, player: PlayerId): Seat | null {
  const i = state.players.indexOf(player);
  return i === 0 || i === 1 ? i : null;
}

function markOf(state: TicTacToeState, seat: Seat): Mark {
  return seat === state.xSeat ? 'X' : 'O';
}

function result(state: TicTacToeState): GameResult {
  const win = winningLine(state.board);
  if (win) return { status: 'win', winner: state.players[win.seat], reason: 'normal' };
  if (state.board.every((c) => c !== null)) return { status: 'draw', reason: 'normal' };
  return { status: 'ongoing' };
}

export const ticTacToe: GamePlugin<TicTacToeState, TicTacToeMove, TicTacToeView> = {
  id: 'tictactoe',
  name: 'Tic-tac-toe',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'alternating',
  defaultTurnSeconds: 60,
  // 9 moves × 60 s = 540 s, plus slack for network latency.
  maxMatchSeconds: 600,

  init({ players, seed }) {
    const [a, b] = players;
    if (a === undefined || b === undefined || players.length !== 2) {
      throw new RangeError('Tic-tac-toe needs exactly 2 players');
    }
    const xSeat: Seat = createRng(seed).int(2) === 0 ? 0 : 1;
    return { players: [a, b], board: Array<Seat | null>(9).fill(null), xSeat, turn: xSeat };
  },

  activePlayers(state) {
    return result(state).status === 'ongoing' ? [state.players[state.turn]] : [];
  },

  validateMove(state, player, move): TicTacToeMove | InvalidMove {
    const seat = seatOf(state, player);
    if (seat === null) return invalid('Not a player in this game');
    if (result(state).status !== 'ongoing') return invalid('Game is over');
    if (seat !== state.turn) return invalid('Not your turn');
    const parsed = MoveSchema.safeParse(move);
    if (!parsed.success) return invalid('Move must be { cell: 0-8 }');
    if (state.board[parsed.data.cell] !== null) return invalid('Cell is already taken');
    return { cell: parsed.data.cell };
  },

  applyMove(state, _player, move) {
    const board = state.board.slice();
    board[move.cell] = state.turn;
    return { ...state, board, turn: state.turn === 0 ? 1 : 0 };
  },

  getResult: result,

  viewFor(state, player) {
    const seat = player === null ? null : seatOf(state, player);
    const live = result(state).status === 'ongoing';
    return {
      board: state.board.map((c) => (c === null ? null : markOf(state, c))),
      marks: {
        [state.players[0]]: markOf(state, 0),
        [state.players[1]]: markOf(state, 1),
      },
      turn: live ? state.players[state.turn] : null,
      you: seat === null ? null : markOf(state, seat),
      winningLine: winningLine(state.board)?.line ?? null,
    };
  },

  legalMoves(state, player) {
    if (seatOf(state, player) !== state.turn || result(state).status !== 'ongoing') return [];
    return state.board.flatMap((c, cell) => (c === null ? [{ cell }] : []));
  },
};

export default ticTacToe;
