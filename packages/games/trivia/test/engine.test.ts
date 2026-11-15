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
  MAIN_QUESTIONS,
  TOTAL_QUESTIONS,
  trivia,
  type TriviaState,
  type TriviaView,
} from '../src/engine.js';
import { QUESTIONS } from '../src/questions.js';

const A = 'alice';
const B = 'bob';
const SEED = 'trivia-seed';

type Session = GameSession<TriviaState>;

function start(seed = SEED): Session {
  return startSession(trivia, testContext(seed));
}

/** Correct displayed index for question `i`, read from the engine state (test-only). */
function correctOf(s: Session, i: number): number {
  const d = s.state.questions[i]!;
  return d.order.indexOf(QUESTIONS[d.bank]!.answer);
}

function wrongOf(s: Session, i: number): number {
  return (correctOf(s, i) + 1) % 4;
}

function answer(s: Session, player: string, choice: number, question?: number): Session {
  const q = question ?? s.state.answers.length - 1;
  const out = submitMove(trivia, s, player, { question: q, choice });
  if (!out.ok) throw new Error(out.reason);
  return out.session;
}

/** Play one question: `true` = answer right, `false` = wrong, `'timeout'` = let the timer run out. */
function round(s: Session, a: boolean | 'timeout', b: boolean | 'timeout'): Session {
  const i = s.state.answers.length - 1;
  let next = s;
  for (const [p, how] of [
    [A, a],
    [B, b],
  ] as const) {
    if (how === 'timeout') next = timeoutPlayer(trivia, next, p);
    else next = answer(next, p, how ? correctOf(s, i) : wrongOf(s, i));
  }
  return next;
}

function playRounds(rounds: [boolean | 'timeout', boolean | 'timeout'][], seed = SEED): Session {
  return rounds.reduce((s, [a, b]) => round(s, a, b), start(seed));
}

const ties = (n: number): [boolean, boolean][] => Array.from({ length: n }, () => [true, true]);

describe('trivia: setup', () => {
  it('deals 8 distinct questions with shuffled options, waiting on both players', () => {
    const s = start();
    expect(s.state.questions).toHaveLength(TOTAL_QUESTIONS);
    expect(new Set(s.state.questions.map((q) => q.bank)).size).toBe(TOTAL_QUESTIONS);
    for (const q of s.state.questions) expect([...q.order].sort()).toEqual([0, 1, 2, 3]);
    expect(waitingOn(trivia, s)).toEqual([A, B]);
    expect(sessionResult(trivia, s)).toEqual({ status: 'ongoing' });
  });

  it('is deterministic by seed, and different seeds deal different games', () => {
    expect(start('x').state).toEqual(start('x').state);
    const deals = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(start(`s${i}`).state.questions)),
    );
    expect(deals.size).toBe(20);
    // Correct answers land in every position across seeds.
    const positions = new Set(Array.from({ length: 40 }, (_, i) => correctOf(start(`p${i}`), 0)));
    expect(positions).toEqual(new Set([0, 1, 2, 3]));
  });

  it('rejects anything but exactly two players', () => {
    expect(() => trivia.init({ players: ['a'], seed: 's' })).toThrow(RangeError);
    expect(() => trivia.init({ players: ['a', 'b', 'c'], seed: 's' })).toThrow(RangeError);
  });

  it('declares a simultaneous model and honest timers', () => {
    expect(trivia.turnModel).toBe('simultaneous');
    expect(trivia.defaultTurnSeconds).toBe(20);
    expect(trivia.maxMatchSeconds).toBeGreaterThanOrEqual(
      TOTAL_QUESTIONS * trivia.defaultTurnSeconds,
    );
  });
});

describe('trivia: question bank', () => {
  it('has at least 150 questions', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(150);
  });

  it('every question has 4 unique non-empty options and a valid answer', () => {
    for (const q of QUESTIONS) {
      expect(q.prompt.trim().length, q.prompt).toBeGreaterThan(0);
      expect(q.options, q.prompt).toHaveLength(4);
      expect(new Set(q.options.map((o) => o.trim().toLowerCase())).size, q.prompt).toBe(4);
      for (const o of q.options) expect(o.trim().length, q.prompt).toBeGreaterThan(0);
      expect([0, 1, 2, 3]).toContain(q.answer);
    }
  });

  it('has no duplicate questions', () => {
    const prompts = QUESTIONS.map((q) => q.prompt.trim().toLowerCase());
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('covers every category, including Bitcoin basics', () => {
    expect(new Set(QUESTIONS.map((q) => q.category))).toEqual(
      new Set(['General', 'Science', 'Geography', 'History', 'Sports', 'Entertainment', 'Bitcoin']),
    );
  });
});

describe('trivia: scoring', () => {
  it('the player with more correct answers after 5 questions wins', () => {
    const s = playRounds([
      [true, false],
      [true, true],
      [false, false],
      [true, false],
      [false, true],
    ]);
    expect(sessionResult(trivia, s)).toEqual({ status: 'win', winner: A, reason: 'normal' });
    expect(trivia.viewFor(s.state, A).scores).toEqual({ [A]: 3, [B]: 2 });
    expect(waitingOn(trivia, s)).toEqual([]);
    expect(trivia.viewFor(s.state, A).current).toBeNull();
    expect(trivia.viewFor(s.state, A).history).toHaveLength(5);
  });

  it('player two can win too', () => {
    const s = playRounds([...ties(4), [false, true]]);
    expect(sessionResult(trivia, s)).toMatchObject({ status: 'win', winner: B });
  });

  it('a tie after 5 goes to sudden death', () => {
    const s = playRounds(ties(MAIN_QUESTIONS));
    expect(sessionResult(trivia, s)).toEqual({ status: 'ongoing' });
    expect(waitingOn(trivia, s)).toEqual([A, B]);
    const view = trivia.viewFor(s.state, A);
    expect(view.suddenDeath).toBe(true);
    expect(view.current?.index).toBe(5);
  });

  it('sudden death: first right answer while the other misses wins', () => {
    const s = playRounds([...ties(5), [false, false], [true, true], [false, true]]);
    expect(sessionResult(trivia, s)).toEqual({ status: 'win', winner: B, reason: 'normal' });
    expect(s.state.answers).toHaveLength(8);
  });

  it('sudden death can be won on its first question', () => {
    const s = playRounds([...ties(5), [true, false]]);
    expect(sessionResult(trivia, s)).toMatchObject({ status: 'win', winner: A });
  });

  it('still tied after 3 sudden-death questions is a draw', () => {
    const s = playRounds([...ties(5), [true, true], [false, false], [true, true]]);
    expect(sessionResult(trivia, s)).toEqual({ status: 'draw', reason: 'normal' });
    expect(waitingOn(trivia, s)).toEqual([]);
    expect(trivia.viewFor(s.state, null).current).toBeNull();
  });
});

describe('trivia: timeouts', () => {
  it('a player who times out gets the question wrong and the game advances', () => {
    let s = start();
    s = answer(s, B, correctOf(s, 0));
    expect(waitingOn(trivia, s)).toEqual([A]);
    s = timeoutPlayer(trivia, s, A);
    expect(s.override).toBeNull();
    expect(waitingOn(trivia, s)).toEqual([A, B]);
    const past = trivia.viewFor(s.state, A).history[0]!;
    expect(past.choices).toEqual({ [A]: null, [B]: correctOf(s, 0) });
    expect(past.right).toEqual({ [A]: false, [B]: true });
  });

  it('both timing out (server loops over waitingOn) closes the question for both', () => {
    let s = start();
    for (const p of waitingOn(trivia, s)) s = timeoutPlayer(trivia, s, p);
    expect(s.state.answers).toHaveLength(2);
    expect(trivia.viewFor(s.state, A).scores).toEqual({ [A]: 0, [B]: 0 });
  });

  it('a whole game of timeouts ends in a draw after sudden death', () => {
    const s = playRounds(Array.from({ length: 8 }, () => ['timeout', 'timeout']));
    expect(sessionResult(trivia, s)).toEqual({ status: 'draw', reason: 'normal' });
  });

  it('timing out the last question decides the game', () => {
    const s = playRounds([...ties(4), [true, 'timeout']]);
    expect(sessionResult(trivia, s)).toMatchObject({ status: 'win', winner: A });
  });

  it('onTimeout ignores players who already answered and strangers', () => {
    const s = answer(start(), A, 0);
    expect(trivia.onTimeout!(s.state, A)).toBe(s.state);
    expect(trivia.onTimeout!(s.state, 'mallory')).toBe(s.state);
  });
});

describe('trivia: illegal moves', () => {
  const s = start();

  it.each([
    ['null', null],
    ['string', '1'],
    ['missing question', { choice: 1 }],
    ['negative choice', { question: 0, choice: -1 }],
    ['choice too big', { question: 0, choice: 4 }],
    ['fraction', { question: 0, choice: 1.5 }],
    ['extra keys', { question: 0, choice: 1, peek: true }],
    ['array', [0, 1]],
  ])('rejects %s input', (_name, move) => {
    expect(submitMove(trivia, s, A, move)).toMatchObject({ ok: false });
  });

  it('rejects the wrong question index', () => {
    expect(trivia.validateMove(s.state, A, { question: 1, choice: 0 })).toEqual({
      invalid: true,
      reason: 'Wrong question',
    });
    const later = round(s, true, true);
    expect(submitMove(trivia, later, A, { question: 0, choice: 0 })).toEqual({
      ok: false,
      reason: 'Wrong question',
    });
  });

  it('rejects answering twice', () => {
    const once = answer(s, A, 2);
    expect(trivia.validateMove(once.state, A, { question: 0, choice: 1 })).toEqual({
      invalid: true,
      reason: 'Already answered',
    });
    expect(submitMove(trivia, once, A, { question: 0, choice: 1 })).toMatchObject({ ok: false });
    expect(trivia.legalMoves!(once.state, A)).toEqual([]);
    expect(trivia.legalMoves!(once.state, B)).toHaveLength(4);
  });

  it('rejects strangers and finished games', () => {
    expect(trivia.validateMove(s.state, 'mallory', { question: 0, choice: 0 })).toMatchObject({
      reason: 'Not a player in this game',
    });
    expect(trivia.legalMoves!(s.state, 'mallory')).toEqual([]);
    const done = playRounds([...ties(4), [true, false]]);
    expect(trivia.validateMove(done.state, A, { question: 5, choice: 0 })).toMatchObject({
      reason: 'Game is over',
    });
  });
});

describe('trivia: no leaks', () => {
  /** Every viewer's serialized view must not reveal hidden info for the open question. */
  function serialized(s: Session): Record<string, string> {
    return {
      [A]: JSON.stringify(trivia.viewFor(s.state, A)),
      [B]: JSON.stringify(trivia.viewFor(s.state, B)),
      observer: JSON.stringify(trivia.viewFor(s.state, null)),
    };
  }

  it('before anyone answers, views carry no correct answer or choices', () => {
    const s = start();
    for (const json of Object.values(serialized(s))) {
      expect(json).not.toMatch(/"correct"|"choices"|"right"|"bank"|"order"|"answer"/);
      const view = JSON.parse(json) as TriviaView;
      expect(view.current?.yourChoice).toBeNull();
      expect(view.history).toEqual([]);
    }
  });

  it('after one player answers, the other sees only that they answered', () => {
    const s = start();
    const choice = wrongOf(s, 0);
    const after = answer(s, A, choice);
    const views = serialized(after);
    const bView = JSON.parse(views[B]!) as TriviaView;
    expect(bView.current?.answered).toEqual({ [A]: true, [B]: false });
    expect(bView.current?.yourChoice).toBeNull();
    // Bob's and the observer's views are identical to before Alice answered, except the flag.
    const before = serialized(s);
    expect(views[B]).toBe(before[B]!.replace(`"${A}":false`, `"${A}":true`));
    expect(views.observer).toBe(before.observer!.replace(`"${A}":false`, `"${A}":true`));
    for (const json of Object.values(views)) {
      expect(json).not.toMatch(/"correct"|"choices"|"right"/);
    }
    // Alice sees her own choice.
    expect((JSON.parse(views[A]!) as TriviaView).current?.yourChoice).toBe(choice);
  });

  it('a past question reveals the correct answer, both choices and correctness', () => {
    let s = start();
    const right = correctOf(s, 0);
    const wrong = wrongOf(s, 0);
    s = answer(s, A, right);
    s = answer(s, B, wrong);
    for (const viewer of [A, B, null]) {
      const view = trivia.viewFor(s.state, viewer);
      expect(view.history[0]).toMatchObject({
        index: 0,
        correct: right,
        choices: { [A]: right, [B]: wrong },
        right: { [A]: true, [B]: false },
      });
      // The newly opened question is still hidden.
      expect(JSON.stringify(view.current)).not.toMatch(/"correct"|"choices"/);
      expect(view.current?.answered).toEqual({ [A]: false, [B]: false });
    }
  });

  it('the observer never has a choice of its own', () => {
    const s = answer(start(), A, 1);
    expect(trivia.viewFor(s.state, null).current?.yourChoice).toBeNull();
    expect(trivia.viewFor(s.state, null).you).toBeNull();
    expect(trivia.viewFor(s.state, 'mallory').you).toBeNull();
  });
});

describe('trivia: purity, caps and replay', () => {
  it('never mutates the previous state', () => {
    const s = start();
    deepFreeze(s.state);
    const next = answer(s, A, 0);
    expect(s.state.answers).toEqual([[null, null]]);
    expect(next.state.answers).toEqual([[0, null]]);
  });

  it('match cap: leader by score wins, a level score draws', () => {
    const ahead = round(start(), false, true);
    expect(sessionResult(trivia, applyMatchCap(trivia, ahead))).toEqual({
      status: 'win',
      winner: B,
      reason: 'match-cap',
    });
    expect(trivia.onMatchCap!(round(start(), true, false).state)).toMatchObject({ winner: A });
    expect(sessionResult(trivia, applyMatchCap(trivia, start()))).toEqual({
      status: 'draw',
      reason: 'match-cap',
    });
  });

  it('a forfeit ends the game for the opponent', () => {
    expect(sessionResult(trivia, forfeit(trivia, start(), A))).toMatchObject({
      status: 'win',
      winner: B,
      reason: 'forfeit',
    });
  });

  it('replays a recorded game exactly', () => {
    let s = round(start(), true, false);
    s = timeoutPlayer(trivia, answer(s, B, 0), A);
    expect(replaySession(trivia, testContext(SEED), s.events)).toEqual(s);
  });
});

describe('trivia: plug-in contract (property-based)', () => {
  it('satisfies the game-sdk contract', () => {
    checkPluginContract(trivia, { numRuns: 200, maxSteps: 40 });
  });
});
