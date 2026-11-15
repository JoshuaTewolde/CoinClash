import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVEAL_MS, TriviaBoard } from '../src/Board.js';
import type { CurrentQuestionView, PastQuestionView, TriviaView } from '../src/engine.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const current = (over: Partial<CurrentQuestionView> = {}): CurrentQuestionView => ({
  index: 1,
  category: 'Science',
  prompt: 'Which planet is known as the Red Planet?',
  options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
  answered: { a: false, b: false },
  yourChoice: null,
  ...over,
});

const past = (over: Partial<PastQuestionView> = {}): PastQuestionView => ({
  index: 0,
  category: 'Geography',
  prompt: 'What is the capital of France?',
  options: ['Lyon', 'Paris', 'Nice', 'Marseille'],
  correct: 1,
  choices: { a: 1, b: 2 },
  right: { a: true, b: false },
  ...over,
});

const view = (over: Partial<TriviaView> = {}): TriviaView => ({
  players: ['a', 'b'],
  you: 'a',
  mainQuestions: 5,
  suddenDeath: false,
  scores: { a: 1, b: 0 },
  current: current(),
  history: [past()],
  ...over,
});

const options = () => screen.getAllByRole('button', { name: /^Answer [A-D]:/ });

describe('TriviaBoard', () => {
  it('shows progress, score and four answer buttons; sends the choice', () => {
    const onMove = vi.fn();
    render(<TriviaBoard view={view()} you="a" canMove onMove={onMove} />);
    expect(screen.getByText('Q 2/5')).toBeTruthy();
    expect(screen.getByLabelText('Score').textContent).toBe('You 1vsThem 0');
    expect(options()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Answer B: Mars' }));
    expect(onMove).toHaveBeenCalledWith({ question: 1, choice: 1 });
    // Locks immediately and waits for the opponent.
    expect(screen.getByText('Waiting for opponent…')).toBeTruthy();
    for (const b of options()) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Answer C: Jupiter' }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('marks your confirmed choice and waits', () => {
    render(
      <TriviaBoard
        view={view({ current: current({ yourChoice: 2, answered: { a: true, b: false } }) })}
        you="a"
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Answer C: Jupiter' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('Waiting for opponent…')).toBeTruthy();
  });

  it('tells you when the opponent already answered', () => {
    render(
      <TriviaBoard
        view={view({ current: current({ answered: { a: false, b: true } }) })}
        you="a"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('Opponent answered. Your move!')).toBeTruthy();
  });

  it('disables answers when it is not your move', () => {
    const onMove = vi.fn();
    render(<TriviaBoard view={view()} you="a" canMove={false} onMove={onMove} />);
    expect(screen.getByText('Pick an answer')).toBeTruthy();
    for (const b of options()) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels sudden-death questions', () => {
    render(
      <TriviaBoard
        view={view({ suddenDeath: true, current: current({ index: 6 }) })}
        you="a"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('Sudden death 2')).toBeTruthy();
  });

  it('reveals the last question when a new one arrives, then moves on', () => {
    vi.useFakeTimers();
    const first = view({ history: [], current: current({ index: 0 }) });
    const { rerender, container } = render(
      <TriviaBoard view={first} you="a" canMove onMove={vi.fn()} />,
    );
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<TriviaBoard view={view()} you="a" canMove onMove={vi.fn()} />);
    expect(screen.getByText('Correct!')).toBeTruthy();
    expect(container.querySelector('.trivia__option--correct')?.textContent).toContain('Paris');
    expect(container.querySelector('.trivia__option--wrong')?.textContent).toContain('Nice');
    expect(container.querySelector('.trivia__option--wrong')?.textContent).toContain('Them');
    expect(screen.queryAllByRole('button', { name: /^Answer/ })).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(REVEAL_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(options()).toHaveLength(4);
  });

  it('the reveal can be skipped', () => {
    const { rerender } = render(
      <TriviaBoard view={view({ history: [] })} you="b" canMove onMove={vi.fn()} />,
    );
    rerender(<TriviaBoard view={view()} you="b" canMove onMove={vi.fn()} />);
    expect(screen.getByText('Wrong!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(options()).toHaveLength(4);
  });

  it('shows "Time’s up!" when you did not answer', () => {
    const { rerender } = render(
      <TriviaBoard view={view({ history: [] })} you="b" canMove onMove={vi.fn()} />,
    );
    rerender(
      <TriviaBoard
        view={view({ history: [past({ choices: { a: 1, b: null } })] })}
        you="b"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('Time’s up!')).toBeTruthy();
  });

  it('keeps the final reveal up when the game is over', () => {
    render(<TriviaBoard view={view({ current: null })} you="a" canMove={false} onMove={vi.fn()} />);
    expect(screen.getByText('Correct!')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next question' })).toBeNull();
  });

  it('renders just the score for a finished game with no history, and for observers', () => {
    render(
      <TriviaBoard
        view={view({ current: null, history: [], you: null })}
        you={null}
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Score')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('defaults missing scores to zero', () => {
    render(<TriviaBoard view={view({ scores: {} })} you="b" canMove onMove={vi.fn()} />);
    expect(screen.getByLabelText('Score').textContent).toBe('You 0vsThem 0');
  });
});
