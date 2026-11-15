/**
 * Rock Paper Scissors (spec §5 item 3). Simultaneous turn model: both players pick each round,
 * the server keeps picks hidden until both are in, then reveals.
 *
 * Rules
 * - Best of 3 by default (first to 2 round wins); the creator may choose best of 5.
 * - A drawn round (same pick) is replayed. Drawn rounds still count toward the round cap.
 * - Round cap: 3 × bestOf rounds (9 for best of 3). If nobody has won by then, the match is a
 *   draw (both stakes are refunded).
 * - Round timer: a player who hasn't picked when the timer ends loses that round. If neither
 *   picked, the round counts as drawn and is replayed. Timeouts never forfeit the match.
 */
import {
  invalid,
  type GamePlugin,
  type GameResult,
  type InvalidMove,
  type PlayerId,
} from '@coinclash/game-sdk';
import { z } from 'zod';

export type Seat = 0 | 1;
export type Pick = 'rock' | 'paper' | 'scissors';
export const PICKS: readonly Pick[] = ['rock', 'paper', 'scissors'];

/** What each pick beats. */
const BEATS: Readonly<Record<Pick, Pick>> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** A seat's slot in the current round: its pick, `'timeout'` if its timer ran out, or null. */
export type Slot = Pick | 'timeout' | null;

export interface RpsOptions {
  readonly bestOf: 3 | 5;
}

export interface RoundRecord {
  /** Each seat's pick; null means that seat timed out. */
  readonly picks: readonly [Pick | null, Pick | null];
  /** Seat that won the round, or null for a drawn (replayed) round. */
  readonly winner: Seat | null;
}

export interface RpsState {
  readonly players: readonly [PlayerId, PlayerId];
  readonly bestOf: 3 | 5;
  /** Current round's slots, by seat. Secret until both are filled. */
  readonly current: readonly [Slot, Slot];
  readonly history: readonly RoundRecord[];
  readonly wins: readonly [number, number];
}

export interface RpsMove {
  readonly pick: Pick;
}

export interface RpsRoundView {
  readonly round: number;
  readonly picks: Readonly<Record<PlayerId, Pick | null>>;
  /** Round winner, or null for a drawn round. */
  readonly winner: PlayerId | null;
  /** Players whose round timer ran out. */
  readonly timedOut: readonly PlayerId[];
}

export interface RpsView {
  readonly players: readonly [PlayerId, PlayerId];
  /** Viewer's id, or null for observers. */
  readonly you: PlayerId | null;
  readonly bestOf: 3 | 5;
  readonly winsNeeded: number;
  readonly maxRounds: number;
  /** Number of the round being played (or the last round, once the match is over). */
  readonly round: number;
  readonly score: Readonly<Record<PlayerId, number>>;
  /** Whether each player has locked in a pick this round. Never the pick itself. */
  readonly picked: Readonly<Record<PlayerId, boolean>>;
  /** The viewer's own pick this round (null for observers or before picking). */
  readonly yourPick: Pick | null;
  /** Completed rounds, oldest first, with both picks revealed. */
  readonly history: readonly RpsRoundView[];
  /** Match winner, once the match is over (null while playing or on a draw). */
  readonly winner: PlayerId | null;
  readonly over: boolean;
}

const MoveSchema = z.object({ pick: z.enum(['rock', 'paper', 'scissors']) }).strict();
const OptionsSchema = z.object({ bestOf: z.union([z.literal(3), z.literal(5)]) }).strict();

export const TURN_SECONDS = 30;
/** Most rounds any match can last (best of 5 → 15 rounds). */
const MAX_ROUNDS_EVER = 15;

export const winsNeeded = (bestOf: number): number => Math.floor(bestOf / 2) + 1;
export const maxRounds = (bestOf: number): number => bestOf * 3;

function seatOf(state: RpsState, player: PlayerId): Seat | null {
  const i = state.players.indexOf(player);
  return i === 0 || i === 1 ? i : null;
}

function result(state: RpsState): GameResult {
  const need = winsNeeded(state.bestOf);
  for (const seat of [0, 1] as const) {
    if (state.wins[seat] >= need) {
      return { status: 'win', winner: state.players[seat], reason: 'normal' };
    }
  }
  if (state.history.length >= maxRounds(state.bestOf)) return { status: 'draw', reason: 'normal' };
  return { status: 'ongoing' };
}

/** Winner of one round from the two slots (both filled). */
function roundWinner(a: Pick | 'timeout', b: Pick | 'timeout'): Seat | null {
  if (a === b) return null; // same pick, or both timed out
  if (a === 'timeout') return 1;
  if (b === 'timeout') return 0;
  return BEATS[a] === b ? 0 : 1;
}

/** Fill `seat`'s slot; resolve the round once both slots are filled. */
function fill(state: RpsState, seat: Seat, slot: Pick | 'timeout'): RpsState {
  const current: [Slot, Slot] = [state.current[0], state.current[1]];
  current[seat] = slot;
  const [a, b] = current;
  if (a === null || b === null) return { ...state, current };
  const winner = roundWinner(a, b);
  const wins: [number, number] = [state.wins[0], state.wins[1]];
  if (winner !== null) wins[winner] += 1;
  const record: RoundRecord = {
    picks: [a === 'timeout' ? null : a, b === 'timeout' ? null : b],
    winner,
  };
  return { ...state, current: [null, null], history: [...state.history, record], wins };
}

function waiting(state: RpsState): Seat[] {
  if (result(state).status !== 'ongoing') return [];
  return ([0, 1] as const).filter((s) => state.current[s] === null);
}

export const rps: GamePlugin<RpsState, RpsMove, RpsView> = {
  id: 'rps',
  name: 'Rock Paper Scissors',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'simultaneous',
  defaultTurnSeconds: TURN_SECONDS,
  // Up to 15 rounds (best of 5) × 30 s = 450 s, plus slack for network latency and reveals.
  maxMatchSeconds: MAX_ROUNDS_EVER * TURN_SECONDS + 90,

  parseOptions(raw): RpsOptions | InvalidMove {
    const parsed = OptionsSchema.safeParse(raw);
    return parsed.success ? parsed.data : invalid('Options must be { bestOf: 3 | 5 }');
  },

  init({ players, options }) {
    const [a, b] = players;
    if (a === undefined || b === undefined || players.length !== 2) {
      throw new RangeError('Rock Paper Scissors needs exactly 2 players');
    }
    const parsed = OptionsSchema.safeParse(options);
    return {
      players: [a, b],
      bestOf: parsed.success ? parsed.data.bestOf : 3,
      current: [null, null],
      history: [],
      wins: [0, 0],
    };
  },

  activePlayers(state) {
    return waiting(state).map((s) => state.players[s]);
  },

  validateMove(state, player, move): RpsMove | InvalidMove {
    const seat = seatOf(state, player);
    if (seat === null) return invalid('Not a player in this game');
    if (result(state).status !== 'ongoing') return invalid('Game is over');
    if (state.current[seat] !== null) return invalid('You already picked this round');
    const parsed = MoveSchema.safeParse(move);
    if (!parsed.success) return invalid('Move must be { pick: rock | paper | scissors }');
    return { pick: parsed.data.pick };
  },

  applyMove(state, player, move) {
    const seat = seatOf(state, player);
    if (seat === null) return state;
    return fill(state, seat, move.pick);
  },

  getResult: result,

  /** A player whose round timer ran out loses the round (both out: the round is replayed). */
  onTimeout(state, player) {
    const seat = seatOf(state, player);
    if (seat === null || !waiting(state).includes(seat)) return state;
    return fill(state, seat, 'timeout');
  },

  /** Hitting the cap mid-match: whoever leads on rounds wins, otherwise a draw. */
  onMatchCap(state): GameResult {
    const [a, b] = state.wins;
    if (a === b) return { status: 'draw', reason: 'match-cap' };
    return { status: 'win', winner: state.players[a > b ? 0 : 1], reason: 'match-cap' };
  },

  viewFor(state, player) {
    const seat = player === null ? null : seatOf(state, player);
    const [p0, p1] = state.players;
    const res = result(state);
    const over = res.status !== 'ongoing';
    const ownSlot = seat === null ? null : state.current[seat];
    return {
      players: [p0, p1],
      you: seat === null ? null : state.players[seat],
      bestOf: state.bestOf,
      winsNeeded: winsNeeded(state.bestOf),
      maxRounds: maxRounds(state.bestOf),
      round: over ? state.history.length : state.history.length + 1,
      score: { [p0]: state.wins[0], [p1]: state.wins[1] },
      picked: { [p0]: state.current[0] !== null, [p1]: state.current[1] !== null },
      yourPick: ownSlot === null || ownSlot === 'timeout' ? null : ownSlot,
      history: state.history.map((r, i) => ({
        round: i + 1,
        picks: { [p0]: r.picks[0], [p1]: r.picks[1] },
        winner: r.winner === null ? null : state.players[r.winner],
        timedOut: ([0, 1] as const).filter((s) => r.picks[s] === null).map((s) => state.players[s]),
      })),
      winner: res.status === 'win' ? res.winner : null,
      over,
    };
  },

  legalMoves(state, player) {
    const seat = seatOf(state, player);
    if (seat === null || !waiting(state).includes(seat)) return [];
    return PICKS.map((pick) => ({ pick }));
  },
};

export default rps;
