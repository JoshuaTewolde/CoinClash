/**
 * Tic-tac-toe board (web only). Pure presentation: renders `TicTacToeView`, sends `{ cell }`
 * intents. The server validates every move. Styling uses the web app's Sticker Arcade tokens.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import type { Mark, TicTacToeMove, TicTacToeView } from './engine.js';
import './board.css';

function MarkGlyph({ mark }: { mark: Mark }) {
  return mark === 'X' ? (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="ttt__glyph ttt__glyph--x">
      <path d="M9 9l22 22M31 9L9 31" />
    </svg>
  ) : (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="ttt__glyph ttt__glyph--o">
      <circle cx="20" cy="20" r="12" />
    </svg>
  );
}

export function TicTacToeBoard({
  view,
  canMove,
  onMove,
}: BoardProps<TicTacToeView, TicTacToeMove>) {
  const line = new Set(view.winningLine ?? []);
  return (
    <div className="ttt" role="grid" aria-label="Tic-tac-toe board">
      {view.board.map((cell, i) => {
        const row = Math.floor(i / 3) + 1;
        const col = (i % 3) + 1;
        const open = cell === null && canMove;
        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            className={`ttt__cell${line.has(i) ? ' ttt__cell--win' : ''}`}
            aria-label={`Row ${row}, column ${col}: ${cell ?? 'empty'}`}
            disabled={!open}
            onClick={() => open && onMove({ cell: i })}
          >
            {cell && <MarkGlyph mark={cell} />}
          </button>
        );
      })}
    </div>
  );
}

export default TicTacToeBoard;
