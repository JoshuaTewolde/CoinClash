import {
  sessionResult,
  startSession,
  submitMove,
  waitingOn,
  type GameSession,
} from '@coinclash/game-sdk';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../src/lib/StoreContext';
import { Store } from '../src/lib/store';
import { BOT, botMove, ENGINES, YOU } from '../src/practice/bot';
import { Practice } from '../src/screens/Practice';

afterEach(cleanup);

/** Deterministic rand for repeatable tests. */
function seeded(n = 1): () => number {
  let x = n;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function play(gameId: string, s: GameSession<unknown>, moves: [string, unknown][]) {
  for (const [p, m] of moves) {
    const out = submitMove(ENGINES[gameId]!, s, p, m);
    if (!out.ok) throw new Error(out.reason);
    s = out.session;
  }
  return s;
}

describe('practice bot', () => {
  it('takes a winning tic-tac-toe move and blocks yours', () => {
    let s = startSession(ENGINES.tictactoe!, { players: [BOT, YOU], seed: 's' });
    // Bot X on 0,1; you O on 3,4 → bot wins on 2.
    s = play('tictactoe', s, [
      [BOT, { cell: 0 }],
      [YOU, { cell: 3 }],
      [BOT, { cell: 1 }],
      [YOU, { cell: 4 }],
    ]);
    expect(botMove('tictactoe', s, BOT, seeded())).toEqual({ cell: 2 });

    let b = startSession(ENGINES.tictactoe!, { players: [YOU, BOT], seed: 's' });
    b = play('tictactoe', b, [
      [YOU, { cell: 0 }],
      [BOT, { cell: 4 }],
      [YOU, { cell: 1 }],
    ]);
    // rand 0.99 never slips the safety check.
    expect(botMove('tictactoe', b, BOT, () => 0.99)).toEqual({ cell: 2 });
  });

  it('blocks a Connect 4 threat', () => {
    let s = startSession(ENGINES.connect4!, { players: [YOU, BOT], seed: 's' });
    s = play('connect4', s, [
      [YOU, { column: 0 }],
      [BOT, { column: 6 }],
      [YOU, { column: 1 }],
      [BOT, { column: 6 }],
      [YOU, { column: 2 }],
    ]);
    expect(botMove('connect4', s, BOT, () => 0.99)).toEqual({ column: 3 });
  });

  it('answers trivia right when its roll says so', () => {
    const s = startSession(ENGINES.trivia!, { players: [YOU, BOT], seed: 's' });
    const right = botMove('trivia', s, BOT, () => 0.1) as { question: number; choice: number };
    const wrong = botMove('trivia', s, BOT, () => 0.9) as { question: number; choice: number };
    expect(right.question).toBe(0);
    expect(wrong.choice).not.toBe(right.choice);
  });

  it('returns null when it is not the bot’s turn, or for unknown games', () => {
    const s = startSession(ENGINES.tictactoe!, { players: [YOU, BOT], seed: 's' });
    expect(botMove('tictactoe', s, BOT)).toBeNull();
    expect(botMove('nope', s, BOT)).toBeNull();
  });

  it.each(['tictactoe', 'connect4', 'rps', 'trivia'])(
    '%s: bot vs bot always finishes with legal moves',
    (gameId) => {
      const plugin = ENGINES[gameId]!;
      for (let g = 0; g < 5; g++) {
        let s = startSession(plugin, { players: [YOU, BOT], seed: `g${g}` });
        const rand = seeded(g + 1);
        for (let i = 0; i < 500 && sessionResult(plugin, s).status === 'ongoing'; i++) {
          for (const p of waitingOn(plugin, s)) {
            const out = submitMove(plugin, s, p, botMove(gameId, s, p, rand));
            expect(out.ok).toBe(true);
            if (out.ok) s = out.session;
          }
        }
        expect(sessionResult(plugin, s).status).not.toBe('ongoing');
      }
    },
  );

  it('pool: picks a legal shot quickly', () => {
    const plugin = ENGINES.pool!;
    let s = startSession(plugin, { players: [BOT, YOU], seed: 'p' });
    const t = performance.now();
    const m = botMove('pool', s, BOT, seeded());
    expect(performance.now() - t).toBeLessThan(5000);
    const out = submitMove(plugin, s, BOT, m);
    expect(out.ok).toBe(true);
    if (out.ok) s = out.session;
    expect(s.events).toHaveLength(1);
  });
});

describe('Practice screen', () => {
  const renderAt = (path: string) =>
    render(
      <StoreProvider store={new Store()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/practice" element={<Practice />} />
            <Route path="/practice/:gameId" element={<Practice />} />
          </Routes>
        </MemoryRouter>
      </StoreProvider>,
    );

  it('lists every game', () => {
    renderAt('/practice');
    for (const name of ['Tic-tac-toe', 'Connect 4', 'Rock Paper Scissors', 'Trivia', 'Pool']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });

  it('plays a free game and can restart', () => {
    renderAt('/practice/rps');
    expect(screen.getByText('Free · no sats')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(screen.getByRole('link', { name: /Sign up to play friends/ })).toBeTruthy();
  });
});
