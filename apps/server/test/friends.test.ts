import type { GameResult } from '@coinclash/game-sdk';
import { describe, expect, it } from 'vitest';
import { friendStats, localDay, streakFrom } from '../src/friends.js';
import type { MatchDoc } from '../src/match/types.js';
import { newDoc } from './helpers.js';

const DAY = 86_400_000;
// 2027-01-15 12:00 UTC
const NOW = Date.UTC(2027, 0, 15, 12);

function finished(
  id: string,
  opponent: string,
  daysAgo: number,
  result: GameResult,
  gameId = 'tictactoe',
): MatchDoc {
  const at = NOW - daysAgo * DAY;
  return {
    ...newDoc({ id, challenger: 'me' }),
    gameId,
    opponent,
    status: 'SETTLED',
    result,
    updatedAt: at + 60_000,
    transitions: [{ from: 'IN_PROGRESS', to: 'SETTLING', at, cause: 'result' }],
  };
}

const win = (winner: string): GameResult => ({ status: 'win', winner, reason: 'normal' });
const draw: GameResult = { status: 'draw', reason: 'normal' };

describe('streakFrom', () => {
  it('counts back from today, or from yesterday when nothing was played today', () => {
    expect(streakFrom(new Set([10, 9, 8, 6]), 10)).toBe(3);
    expect(streakFrom(new Set([9, 8]), 10)).toBe(2);
    expect(streakFrom(new Set([8, 7]), 10)).toBe(0);
    expect(streakFrom(new Set(), 10)).toBe(0);
  });
});

describe('localDay', () => {
  it('uses the viewer timezone offset (getTimezoneOffset convention)', () => {
    // 2027-01-15 03:00 UTC is still Jan 14 in New York (UTC-5, offset +300).
    const t = Date.UTC(2027, 0, 15, 3);
    expect(localDay(t, 300)).toBe(localDay(t, 0) - 1);
  });
});

describe('friendStats', () => {
  const names = new Map([
    ['maya', 'Maya'],
    ['dev', 'Dev'],
  ]);

  it('builds streaks, games played and per-game records, most recent friend first', () => {
    const docs = [
      finished('a', 'maya', 0, win('me')),
      finished('b', 'maya', 1, win('maya')),
      finished('c', 'maya', 1, draw, 'connect4'),
      finished('d', 'maya', 2, win('me')),
      finished('e', 'dev', 3, win('dev')),
    ];
    const stats = friendStats(docs, 'me', names, NOW, 0);
    expect(stats.map((s) => s.id)).toEqual(['maya', 'dev']);
    expect(stats[0]).toMatchObject({
      nickname: 'Maya',
      streakDays: 3,
      gamesPlayed: 4,
      record: { wins: 2, losses: 1, draws: 1 },
      byGame: {
        tictactoe: { wins: 2, losses: 1, draws: 0 },
        connect4: { wins: 0, losses: 0, draws: 1 },
      },
    });
    expect(stats[1]).toMatchObject({ nickname: 'Dev', streakDays: 0, gamesPlayed: 1 });
  });

  it('ignores matches without a game result (declined, cancelled, ongoing)', () => {
    const noResult = { ...finished('x', 'maya', 0, draw), result: null, status: 'CANCELLED' };
    expect(friendStats([noResult as MatchDoc], 'me', names, NOW, 0)).toEqual([]);
  });

  it('falls back to updatedAt and a default nickname', () => {
    const doc = { ...finished('y', 'ghost', 0, win('me')), transitions: [] };
    const [s] = friendStats([doc], 'me', names, NOW, 0);
    expect(s).toMatchObject({ nickname: 'Player', streakDays: 1, lastPlayedAt: doc.updatedAt });
  });
});
