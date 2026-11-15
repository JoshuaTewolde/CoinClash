import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicTacToeBoard } from '../src/Board.js';
import type { TicTacToeView } from '../src/engine.js';

afterEach(cleanup);

const view = (over: Partial<TicTacToeView> = {}): TicTacToeView => ({
  board: ['X', null, null, null, 'O', null, null, null, null],
  marks: { a: 'X', b: 'O' },
  turn: 'a',
  you: 'X',
  winningLine: null,
  ...over,
});

describe('TicTacToeBoard', () => {
  it('sends a cell intent for empty cells only when it is your move', () => {
    const onMove = vi.fn();
    render(<TicTacToeBoard view={view()} you="a" canMove onMove={onMove} />);
    fireEvent.click(screen.getByRole('gridcell', { name: 'Row 1, column 2: empty' }));
    expect(onMove).toHaveBeenCalledWith({ cell: 1 });
    const taken = screen.getByRole('gridcell', { name: 'Row 1, column 1: X' });
    expect((taken as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables every cell while waiting on the opponent', () => {
    render(<TicTacToeBoard view={view()} you="a" canMove={false} onMove={vi.fn()} />);
    for (const cell of screen.getAllByRole('gridcell')) {
      expect((cell as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('highlights the winning line', () => {
    const { container } = render(
      <TicTacToeBoard
        view={view({
          board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
          winningLine: [0, 1, 2],
          turn: null,
        })}
        you="a"
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.ttt__cell--win')).toHaveLength(3);
  });
});
