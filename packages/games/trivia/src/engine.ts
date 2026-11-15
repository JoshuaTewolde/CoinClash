/**
 * Trivia: both players answer the same multiple-choice question at once (simultaneous model).
 * Five questions; a tie goes to up to three sudden-death questions, then a draw.
 * The seed picks the questions and shuffles each question's options.
 */
import {
  createRng,
  invalid,
  type GamePlugin,
  type GameResult,
  type InvalidMove,
  type PlayerId,
} from '@coinclash/game-sdk';
import { z } from 'zod';
import { QUESTIONS, type Category, type Question } from './questions.js';

export type Seat = 0 | 1;

/** Questions in the main round. */
export const MAIN_QUESTIONS = 5;
/** Extra questions played one at a time while the score is tied. */
export const SUDDEN_DEATH_QUESTIONS = 3;
export const TOTAL_QUESTIONS = MAIN_QUESTIONS + SUDDEN_DEATH_QUESTIONS;

/** A player's answer slot: `null` = not answered yet, `-1` = timed out, `0..3` = choice. */
export type Answer = number | null;

export interface DealtQuestion {
  /** Index into `QUESTIONS`. */
  readonly bank: number;
  /** Display order: `order[i]` is the bank option shown at position `i`. */
  readonly order: readonly number[];
}

export interface TriviaState {
  readonly players: readonly [PlayerId, PlayerId];
  /** All questions this match may use (main round + sudden death), fixed at init. */
  readonly questions: readonly DealtQuestion[];
  /** One entry per question reached so far; the last one may still be open. */
  readonly answers: readonly (readonly [Answer, Answer])[];
}

export interface TriviaMove {
  /** 0-based index of the question being answered (must be the current one). */
  readonly question: number;
  /** Displayed option index. */
  readonly choice: number;
}

export interface CurrentQuestionView {
  readonly index: number;
  readonly category: Category;
  readonly prompt: string;
  readonly options: readonly string[];
  /** Whether each player has answered. Never their choice. */
  readonly answered: Readonly<Record<PlayerId, boolean>>;
  /** The viewer's own choice, once made. */
  readonly yourChoice: number | null;
}

export interface PastQuestionView {
  readonly index: number;
  readonly category: Category;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly correct: number;
  /** Each player's choice, or null if they timed out. */
  readonly choices: Readonly<Record<PlayerId, number | null>>;
  readonly right: Readonly<Record<PlayerId, boolean>>;
}

export interface TriviaView {
  readonly players: readonly [PlayerId, PlayerId];
  /** The viewer, or null for observers. */
  readonly you: PlayerId | null;
  readonly mainQuestions: number;
  readonly suddenDeath: boolean;
  /** Correct answers over finished questions only. */
  readonly scores: Readonly<Record<PlayerId, number>>;
  /** The open question, or null when the game is over. */
  readonly current: CurrentQuestionView | null;
  readonly history: readonly PastQuestionView[];
}

const MoveSchema = z
  .object({ question: z.number().int().min(0), choice: z.number().int().min(0).max(3) })
  .strict();

const TIMED_OUT = -1;

function seatOf(state: TriviaState, player: PlayerId | null): Seat | null {
  if (player === null) return null;
  const i = state.players.indexOf(player);
  return i === 0 || i === 1 ? i : null;
}

function dealt(state: TriviaState, index: number): DealtQuestion {
  return state.questions[index] as DealtQuestion;
}

function bankQuestion(d: DealtQuestion): Question {
  return QUESTIONS[d.bank] as Question;
}

/** Displayed index of the correct option. */
function correctIndex(d: DealtQuestion): number {
  return d.order.indexOf(bankQuestion(d).answer);
}

/** The open (last) answer pair. `answers` is never empty. */
function openPair(state: TriviaState): readonly [Answer, Answer] {
  return state.answers[state.answers.length - 1] as readonly [Answer, Answer];
}

function isClosed(pair: readonly [Answer, Answer]): boolean {
  return pair[0] !== null && pair[1] !== null;
}

function closedCount(state: TriviaState): number {
  return state.answers.filter(isClosed).length;
}

function scores(state: TriviaState): [number, number] {
  const out: [number, number] = [0, 0];
  state.answers.forEach((pair, i) => {
    if (!isClosed(pair)) return;
    const correct = correctIndex(dealt(state, i));
    if (pair[0] === correct) out[0]++;
    if (pair[1] === correct) out[1]++;
  });
  return out;
}

function result(state: TriviaState): GameResult {
  const done = closedCount(state);
  if (done < MAIN_QUESTIONS) return { status: 'ongoing' };
  const [a, b] = scores(state);
  if (a !== b) return { status: 'win', winner: state.players[a > b ? 0 : 1], reason: 'normal' };
  if (done >= TOTAL_QUESTIONS) return { status: 'draw', reason: 'normal' };
  return { status: 'ongoing' };
}

/** Record `answer` for `seat` on the open question, opening the next one if both are in. */
function record(state: TriviaState, seat: Seat, answer: number): TriviaState {
  const last = state.answers.length - 1;
  const pair = openPair(state);
  const updated: [Answer, Answer] = seat === 0 ? [answer, pair[1]] : [pair[0], answer];
  const answers = [...state.answers.slice(0, last), updated];
  const next = { ...state, answers };
  if (isClosed(updated) && result(next).status === 'ongoing') {
    return { ...next, answers: [...answers, [null, null]] };
  }
  return next;
}

function pending(state: TriviaState): Seat[] {
  if (result(state).status !== 'ongoing') return [];
  const pair = openPair(state);
  return ([0, 1] as const).filter((s) => pair[s] === null);
}

function optionsOf(d: DealtQuestion): string[] {
  const q = bankQuestion(d);
  return d.order.map((o) => q.options[o] as string);
}

export const trivia: GamePlugin<TriviaState, TriviaMove, TriviaView> = {
  id: 'trivia',
  name: 'Trivia',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'simultaneous',
  defaultTurnSeconds: 20,
  // Up to 8 questions × 20 s = 160 s, plus slack for network latency.
  maxMatchSeconds: 240,

  init({ players, seed }) {
    const [a, b] = players;
    if (a === undefined || b === undefined || players.length !== 2) {
      throw new RangeError('Trivia needs exactly 2 players');
    }
    const rng = createRng(seed);
    const picks = rng.shuffle(QUESTIONS.map((_, i) => i)).slice(0, TOTAL_QUESTIONS);
    const questions = picks.map((bank) => ({ bank, order: rng.shuffle([0, 1, 2, 3]) }));
    return { players: [a, b], questions, answers: [[null, null]] };
  },

  activePlayers(state) {
    return pending(state).map((s) => state.players[s]);
  },

  validateMove(state, player, move): TriviaMove | InvalidMove {
    const seat = seatOf(state, player);
    if (seat === null) return invalid('Not a player in this game');
    if (result(state).status !== 'ongoing') return invalid('Game is over');
    const parsed = MoveSchema.safeParse(move);
    if (!parsed.success) return invalid('Move must be { question, choice: 0-3 }');
    if (parsed.data.question !== state.answers.length - 1) return invalid('Wrong question');
    if (!pending(state).includes(seat)) return invalid('Already answered');
    return { question: parsed.data.question, choice: parsed.data.choice };
  },

  applyMove(state, player, move) {
    // validateMove already checked `player` is seated and still owes an answer.
    return record(state, seatOf(state, player) as Seat, move.choice);
  },

  getResult: result,

  onTimeout(state, player) {
    const seat = seatOf(state, player);
    if (seat === null || !pending(state).includes(seat)) return state;
    return record(state, seat, TIMED_OUT);
  },

  onMatchCap(state) {
    const [a, b] = scores(state);
    if (a === b) return { status: 'draw', reason: 'match-cap' };
    return { status: 'win', winner: state.players[a > b ? 0 : 1], reason: 'match-cap' };
  },

  viewFor(state, player) {
    const seat = seatOf(state, player);
    const [p0, p1] = state.players;
    const [s0, s1] = scores(state);
    const history: PastQuestionView[] = [];
    let current: CurrentQuestionView | null = null;
    for (const [index, pair] of state.answers.entries()) {
      const d = dealt(state, index);
      const q = bankQuestion(d);
      const base = { index, category: q.category, prompt: q.prompt, options: optionsOf(d) };
      if (isClosed(pair)) {
        const correct = correctIndex(d);
        const shown = (a: Answer) => (a === TIMED_OUT ? null : a);
        history.push({
          ...base,
          correct,
          choices: { [p0]: shown(pair[0]), [p1]: shown(pair[1]) },
          right: { [p0]: pair[0] === correct, [p1]: pair[1] === correct },
        });
      } else {
        // Only the viewer's own choice; the opponent's stays hidden until both are in.
        const mine = seat === null ? null : pair[seat];
        current = {
          ...base,
          answered: { [p0]: pair[0] !== null, [p1]: pair[1] !== null },
          yourChoice: mine === TIMED_OUT ? null : mine,
        };
      }
    }
    return {
      players: state.players,
      you: seat === null ? null : state.players[seat],
      mainQuestions: MAIN_QUESTIONS,
      suddenDeath: state.answers.length > MAIN_QUESTIONS,
      scores: { [p0]: s0, [p1]: s1 },
      current,
      history,
    };
  },

  legalMoves(state, player) {
    const seat = seatOf(state, player);
    if (seat === null || !pending(state).includes(seat)) return [];
    const question = state.answers.length - 1;
    return [0, 1, 2, 3].map((choice) => ({ question, choice }));
  },
};

export default trivia;
