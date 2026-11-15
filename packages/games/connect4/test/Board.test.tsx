import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connect4Board } from '../src/Board.js';
import type { Connect4View, Disc } from '../src/engine.js';

afterEach(cleanup);

function emptyBoard(): (Disc | null)[][] {
  return Array.from({ length: 6 }, () => Array<Disc | null>(7).fill(null));
}

const view = (over: Partial<Connect4View> = {}): Connect4View => {
  const board = emptyBoard();
  board[5]![3] = 'red';
  return {
    board,
    colors: { a: 'red', b: 'yellow' },
    turn: 'b',
    you: 'yellow',
    winningLine: null,
    lastMove: { row: 5, col: 3 },
    ...over,
  };
};

describe('Connect4Board', () => {
  it('sends a column intent when it is your move', () => {
    const onMove = vi.fn();
    render(<Connect4Board view={view()} you="b" canMove onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop in column 3' }));
    expect(onMove).toHaveBeenCalledWith({ column: 2 });
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByText('You are Yellow')).toBeTruthy();
  });

  it('names every cell and animates the last drop', () => {
    const { container } = render(
      <Connect4Board view={view()} you="b" canMove={false} onMove={vi.fn()} />,
    );
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
    expect(screen.getByRole('gridcell', { name: 'Row 6, column 4: red' })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: 'Row 1, column 1: empty' })).toBeTruthy();
    const dropped = container.querySelector('.c4__disc--drop') as HTMLElement;
    expect(dropped.classList.contains('c4__disc--red')).toBe(true);
    expect(dropped.style.getPropertyValue('--c4-fall')).toBe('6');
  });

  it('disables every column while waiting on the opponent', () => {
    const onMove = vi.fn();
    render(<Connect4Board view={view()} you="b" canMove={false} onMove={onMove} />);
    for (const col of screen.getAllByRole('button')) {
      expect((col as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(col);
    }
    expect(onMove).not.toHaveBeenCalled();
  });

  it('disables a full column', () => {
    const board = emptyBoard();
    for (let r = 0; r < 6; r++) board[r]![0] = r % 2 ? 'red' : 'yellow';
    render(<Connect4Board view={view({ board })} you="b" canMove onMove={vi.fn()} />);
    const full = screen.getByRole('button', { name: 'Drop in column 1' }) as HTMLButtonElement;
    const open = screen.getByRole('button', { name: 'Drop in column 2' }) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    expect(open.disabled).toBe(false);
  });

  it('highlights the winning four and hides the color label for observers', () => {
    const board = emptyBoard();
    for (let r = 2; r < 6; r++) board[r]![0] = 'red';
    const { container } = render(
      <Connect4Board
        view={view({
          board,
          you: null,
          turn: null,
          lastMove: null,
          winningLine: [2, 3, 4, 5].map((row) => ({ row, col: 0 })),
        })}
        you={null}
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.c4__cell--win')).toHaveLength(4);
    expect(container.querySelector('.c4__disc--drop')).toBeNull();
    expect(screen.queryByText(/You are/)).toBeNull();
  });
});
