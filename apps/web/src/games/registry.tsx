/**
 * Web-side game registry: name, icon, tile color and board per game id. The server's
 * `/api/config` decides which games are playable; the others show as "Coming soon".
 */
import type { BoardProps } from '@coinclash/game-sdk';
import { TicTacToeBoard } from '@coinclash/game-tictactoe/board';
import type { ComponentType } from 'react';

export interface GameMeta {
  readonly id: string;
  readonly name: string;
  /** CSS color token for the tile. */
  readonly color: string;
  readonly Board?: ComponentType<BoardProps>;
}

export const GAMES: readonly GameMeta[] = [
  {
    id: 'tictactoe',
    name: 'Tic-tac-toe',
    color: 'var(--cc-sunflower)',
    Board: TicTacToeBoard as ComponentType<BoardProps>,
  },
  { id: 'connect4', name: 'Connect 4', color: 'var(--cc-teal)' },
  { id: 'rps', name: 'Rock Paper Scissors', color: 'var(--cc-tomato)' },
  { id: 'trivia', name: 'Trivia', color: 'var(--cc-white)' },
];

export function gameMeta(id: string): GameMeta {
  return GAMES.find((g) => g.id === id) ?? { id, name: id, color: 'var(--cc-white)' };
}

const stroke = {
  fill: 'none',
  stroke: 'var(--cc-ink)',
  strokeWidth: 3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Per-game icons (ADR 0009 item 4): flat fills, 3px ink stroke. */
export function GameIcon({ id }: { id: string }) {
  switch (id) {
    case 'tictactoe':
      return (
        <svg className="game-icon" viewBox="0 0 40 40" aria-hidden="true" {...stroke}>
          <path d="M14 4v32M26 4v32M4 14h32M4 26h32" />
          <path d="M6 6l5 5M11 6l-5 5" strokeWidth="2.5" />
          <circle cx="20" cy="20" r="3.2" strokeWidth="2.5" />
          <path d="M29 29l5 5M34 29l-5 5" strokeWidth="2.5" />
        </svg>
      );
    case 'connect4':
      return (
        <svg className="game-icon" viewBox="0 0 40 40" aria-hidden="true" {...stroke}>
          <rect x="3" y="7" width="34" height="28" rx="4" fill="var(--cc-white)" />
          <circle cx="11" cy="15" r="3.5" />
          <circle cx="20" cy="15" r="3.5" />
          <circle cx="29" cy="15" r="3.5" fill="var(--cc-tomato)" />
          <circle cx="11" cy="26" r="3.5" fill="var(--cc-sunflower)" />
          <circle cx="20" cy="26" r="3.5" fill="var(--cc-tomato)" />
          <circle cx="29" cy="26" r="3.5" fill="var(--cc-sunflower)" />
        </svg>
      );
    case 'rps':
      return (
        <svg className="game-icon" viewBox="0 0 40 40" aria-hidden="true" {...stroke}>
          <circle cx="9" cy="29" r="5" fill="var(--cc-white)" />
          <circle cx="20" cy="29" r="5" fill="var(--cc-white)" />
          <path d="M12 25L28 5M17 25L4 8" />
          <rect x="26" y="20" width="11" height="15" rx="1.5" fill="var(--cc-white)" />
        </svg>
      );
    case 'trivia':
      return (
        <svg className="game-icon" viewBox="0 0 40 40" aria-hidden="true" {...stroke}>
          <path
            d="M5 8a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H17l-8 7v-7a4 4 0 0 1-4-4z"
            fill="var(--cc-sunflower)"
          />
          <path d="M16 12a4 4 0 1 1 5.5 3.7c-1 .4-1.5 1.2-1.5 2.3" />
          <circle cx="20" cy="23" r="0.6" fill="var(--cc-ink)" />
        </svg>
      );
    default:
      return (
        <svg className="game-icon" viewBox="0 0 40 40" aria-hidden="true" {...stroke}>
          <rect x="6" y="6" width="28" height="28" rx="6" />
        </svg>
      );
  }
}

export function GameBadge({ id }: { id: string }) {
  return (
    <span className="game-badge" style={{ background: gameMeta(id).color }}>
      <GameIcon id={id} />
    </span>
  );
}
