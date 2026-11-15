import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpsBoard } from '../src/Board.js';
import type { RpsView } from '../src/engine.js';

afterEach(cleanup);

const view = (over: Partial<RpsView> = {}): RpsView => ({
  players: ['a', 'b'],
  you: 'a',
  bestOf: 3,
  winsNeeded: 2,
  maxRounds: 9,
  round: 1,
  score: { a: 0, b: 0 },
  picked: { a: false, b: false },
  yourPick: null,
  history: [],
  winner: null,
  over: false,
  ...over,
});

describe('RpsBoard', () => {
  it('sends a pick intent when you can move', () => {
    const onMove = vi.fn();
    render(<RpsBoard view={view()} you="a" canMove onMove={onMove} />);
    expect(screen.getByText('Make your pick')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scissors' }));
    expect(onMove).toHaveBeenCalledWith({ pick: 'scissors' });
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows waiting after you pick, with your pick marked and buttons locked', () => {
    const onMove = vi.fn();
    render(
      <RpsBoard
        view={view({ yourPick: 'rock', picked: { a: true, b: false } })}
        you="a"
        canMove={false}
        onMove={onMove}
      />,
    );
    expect(screen.getByText('Waiting for opponent…')).toBeTruthy();
    const rock = screen.getByRole('button', { name: 'Rock' }) as HTMLButtonElement;
    expect(rock.getAttribute('aria-pressed')).toBe('true');
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rock);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('nudges you when the opponent has already picked', () => {
    render(
      <RpsBoard view={view({ picked: { a: false, b: true } })} you="a" canMove onMove={vi.fn()} />,
    );
    expect(screen.getByText('They’ve picked. Your move!')).toBeTruthy();
  });

  it('reveals the last round, score and history chips', () => {
    const { container } = render(
      <RpsBoard
        view={view({
          round: 3,
          score: { a: 1, b: 0 },
          history: [
            { round: 1, picks: { a: 'rock', b: 'rock' }, winner: null, timedOut: [] },
            { round: 2, picks: { a: 'paper', b: 'rock' }, winner: 'a', timedOut: [] },
          ],
        })}
        you="a"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Score: you 1, them 0')).toBeTruthy();
    expect(screen.getByText(/Round 3/)).toBeTruthy();
    expect(screen.getByText('You win the round!')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Round 2: you paper, them rock' })).toBeTruthy();
    const chips = [...container.querySelectorAll('.rps__chip')].map((c) => c.textContent);
    expect(chips).toEqual(['R1 Tie', 'R2 W']);
  });

  it('shows ties, lost rounds and timeouts', () => {
    const { rerender } = render(
      <RpsBoard
        view={view({
          history: [{ round: 1, picks: { a: 'rock', b: 'rock' }, winner: null, timedOut: [] }],
        })}
        you="a"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('Tie round, go again!')).toBeTruthy();
    rerender(
      <RpsBoard
        view={view({
          over: true,
          winner: 'b',
          score: { a: 0, b: 2 },
          history: [
            { round: 1, picks: { a: 'rock', b: 'paper' }, winner: 'b', timedOut: [] },
            { round: 2, picks: { a: null, b: 'paper' }, winner: 'b', timedOut: ['a'] },
          ],
        })}
        you="a"
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('They win the round')).toBeTruthy();
    expect(screen.getByText('You: Out of time')).toBeTruthy();
    expect(screen.getByText('Match over')).toBeTruthy();
    expect(screen.getByText('R1 L')).toBeTruthy();
  });

  it('labels an opponent timeout in the reveal', () => {
    render(
      <RpsBoard
        view={view({
          history: [{ round: 1, picks: { a: 'rock', b: null }, winner: 'a', timedOut: ['b'] }],
        })}
        you="a"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('status', { name: 'Round 1: you rock, them ran out of time' }),
    ).toBeTruthy();
    expect(screen.getByText('Them: Out of time')).toBeTruthy();
  });

  it('observers watch from the first seat', () => {
    render(
      <RpsBoard
        view={view({ you: null, score: { a: 1, b: 0 } })}
        you={null}
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Score: you 1, them 0')).toBeTruthy();
  });

  it('shows the score from the second seat too', () => {
    render(
      <RpsBoard
        view={view({ you: 'b', score: { a: 1, b: 0 } })}
        you="b"
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Score: you 0, them 1')).toBeTruthy();
  });
});
