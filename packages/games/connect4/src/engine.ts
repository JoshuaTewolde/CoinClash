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
export type Disc = 'red' | 'yellow';

export const COLUMNS = 7;
export const ROWS = 6;

/** A board position. Row 0 is the top row, column 0 the leftmost column. */
export interface Cell {
  readonly row: number;
  readonly col: number;
}

export interface Connect4State {
  readonly players: readonly [PlayerId, PlayerId];
  /** ROWS × COLUMNS cells, row-major from the top. Each holds the seat that dropped there, or null. */
  readonly board: readonly (Seat | null)[];
  /** Seat that plays red and moves first (chosen from the match seed). */
  readonly redSeat: Seat;
  /** Seat to move next. */
  readonly turn: Seat;
  /** Where the last disc landed, or null before the first move. */
  readonly lastMove: Cell | null;
}

export interface Connect4Move {
  readonly column: number;
}

export interface Connect4View {
  /** ROWS rows (top first) of COLUMNS cells each. */
  readonly board: readonly (readonly (Disc | null)[])[];
  readonly colors: Readonly<Record<PlayerId, Disc>>;
  /** Player to move, or null when the game is over. */
  readonly turn: PlayerId | null;
  /** The viewer's color, or null for observers. */
  readonly you: Disc | null;
  /** Cells of the winning line(s), if any. */
  readonly winningLine: readonly Cell[] | null;
  /** Where the last disc landed, for the drop animation. */
  readonly lastMove: Cell | null;
}

const MoveSchema = z
  .object({
    column: z
      .number()
      .int()
      .min(0)
      .max(COLUMNS - 1),
  })
  .strict();

/** Directions to scan for four in a row: right, down, down-right, down-left. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const at = (board: readonly (Seat | null)[], row: number, col: number): Seat | null =>
  row < 0 || row >= ROWS || col < 0 || col >= COLUMNS ? null : (board[row * COLUMNS + col] ?? null);

/** The winning seat and every cell that is part of a four-in-a-row for it. */
function findWin(board: readonly (Seat | null)[]): { seat: Seat; cells: Cell[] } | null {
  let winner: Seat | null = null;
  const cells = new Map<number, Cell>();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const s = at(board, row, col);
      if (s === null) continue;
      for (const [dr, dc] of DIRECTIONS) {
        let n = 1;
        while (n < 4 && at(board, row + dr * n, col + dc * n) === s) n++;
        if (n < 4) continue;
        winner = s;
        for (let i = 0; i < 4; i++) {
          const r = row + dr * i;
          const c = col + dc * i;
          cells.set(r * COLUMNS + c, { row: r, col: c });
        }
      }
    }
  }
  if (winner === null) return null;
  return { seat: winner, cells: [...cells.entries()].sort(([a], [b]) => a - b).map(([, c]) => c) };
}

/** Lowest empty row in `col`, or -1 if the column is full. */
function dropRow(board: readonly (Seat | null)[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) if (board[row * COLUMNS + col] === null) return row;
  return -1;
}

function seatOf(state: Connect4State, player: PlayerId): Seat | null {
  const i = state.players.indexOf(player);
  return i === 0 || i === 1 ? i : null;
}

function discOf(state: Connect4State, seat: Seat): Disc {
  return seat === state.redSeat ? 'red' : 'yellow';
}

function result(state: Connect4State): GameResult {
  const win = findWin(state.board);
  if (win) return { status: 'win', winner: state.players[win.seat], reason: 'normal' };
  if (state.board.every((c) => c !== null)) return { status: 'draw', reason: 'normal' };
  return { status: 'ongoing' };
}

export const connect4: GamePlugin<Connect4State, Connect4Move, Connect4View> = {
  id: 'connect4',
  name: 'Connect 4',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'alternating',
  defaultTurnSeconds: 60,
  // Real games take a few minutes; a 20-minute cap ends stalled games as a draw (default
  // onMatchCap) and bounds the stake HTLC expiry.
  maxMatchSeconds: 1200,

  init({ players, seed }) {
    const [a, b] = players;
    if (a === undefined || b === undefined || players.length !== 2) {
      throw new RangeError('Connect 4 needs exactly 2 players');
    }
    const redSeat: Seat = createRng(seed).int(2) === 0 ? 0 : 1;
    return {
      players: [a, b],
      board: Array<Seat | null>(ROWS * COLUMNS).fill(null),
      redSeat,
      turn: redSeat,
      lastMove: null,
    };
  },

  activePlayers(state) {
    return result(state).status === 'ongoing' ? [state.players[state.turn]] : [];
  },

  validateMove(state, player, move): Connect4Move | InvalidMove {
    const seat = seatOf(state, player);
    if (seat === null) return invalid('Not a player in this game');
    if (result(state).status !== 'ongoing') return invalid('Game is over');
    if (seat !== state.turn) return invalid('Not your turn');
    const parsed = MoveSchema.safeParse(move);
    if (!parsed.success) return invalid('Move must be { column: 0-6 }');
    if (dropRow(state.board, parsed.data.column) < 0) return invalid('Column is full');
    return { column: parsed.data.column };
  },

  applyMove(state, _player, move) {
    const row = dropRow(state.board, move.column);
    const board = state.board.slice();
    board[row * COLUMNS + move.column] = state.turn;
    return {
      ...state,
      board,
      turn: state.turn === 0 ? 1 : 0,
      lastMove: { row, col: move.column },
    };
  },

  getResult: result,

  viewFor(state, player) {
    const seat = player === null ? null : seatOf(state, player);
    const live = result(state).status === 'ongoing';
    const rows: (Disc | null)[][] = [];
    for (let row = 0; row < ROWS; row++) {
      rows.push(
        state.board
          .slice(row * COLUMNS, (row + 1) * COLUMNS)
          .map((c) => (c === null ? null : discOf(state, c))),
      );
    }
    return {
      board: rows,
      colors: {
        [state.players[0]]: discOf(state, 0),
        [state.players[1]]: discOf(state, 1),
      },
      turn: live ? state.players[state.turn] : null,
      you: seat === null ? null : discOf(state, seat),
      winningLine: findWin(state.board)?.cells ?? null,
      lastMove: state.lastMove,
    };
  },

  legalMoves(state, player) {
    if (seatOf(state, player) !== state.turn || result(state).status !== 'ongoing') return [];
    const moves: Connect4Move[] = [];
    for (let column = 0; column < COLUMNS; column++) {
      if (dropRow(state.board, column) >= 0) moves.push({ column });
    }
    return moves;
  },
};

export default connect4;
