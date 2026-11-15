/**
 * Connect 4 board (web only). Pure presentation: renders `Connect4View`, sends `{ column }`
 * intents. The server validates every move. Styling uses the web app's Sticker Arcade tokens.
 *
 * Layout: a 6 × 7 grid of holes, with 7 full-height column buttons laid over it as tap targets.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import type { CSSProperties } from 'react';
import type { Connect4Move, Connect4View, Disc } from './engine.js';
import './board.css';

const NAMES: Record<Disc, string> = { red: 'Red', yellow: 'Yellow' };

export function Connect4Board({ view, canMove, onMove }: BoardProps<Connect4View, Connect4Move>) {
  const win = new Set((view.winningLine ?? []).map((c) => `${c.row}:${c.col}`));
  const columns = view.board[0]?.length ?? 0;
  const last = view.lastMove;

  return (
    <div className="c4">
      {view.you && (
        <p className="c4__you">
          <span className={`c4__chip c4__chip--${view.you}`} aria-hidden="true" />
          You are {NAMES[view.you]}
        </p>
      )}
      <div className="c4__board">
        <div className="c4__grid" role="grid" aria-label="Connect 4 board">
          {view.board.map((cells, row) => (
            <div key={row} role="row" className="c4__row">
              {cells.map((disc, col) => {
                const isWin = win.has(`${row}:${col}`);
                const isLast = last !== null && last.row === row && last.col === col;
                return (
                  <span
                    key={col}
                    role="gridcell"
                    className={`c4__cell${isWin ? ' c4__cell--win' : ''}`}
                    aria-label={`Row ${row + 1}, column ${col + 1}: ${disc ?? 'empty'}`}
                  >
                    {disc && (
                      <span
                        className={`c4__disc c4__disc--${disc}${isLast ? ' c4__disc--drop' : ''}`}
                        style={isLast ? ({ '--c4-fall': row + 1 } as CSSProperties) : undefined}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <div className="c4__cols">
          {Array.from({ length: columns }, (_, col) => {
            const open = canMove && view.board[0]?.[col] === null;
            return (
              <button
                key={col}
                type="button"
                className="c4__col"
                aria-label={`Drop in column ${col + 1}`}
                disabled={!open}
                onClick={() => open && onMove({ column: col })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Connect4Board;
