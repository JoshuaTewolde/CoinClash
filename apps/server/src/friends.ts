/**
 * Head-to-head stats for the Home friend tiles and the friend detail screen (ADR 0009).
 * Pure: derived from the viewer's match documents, no extra collection.
 */
import type { FriendStats, Record3 } from '@coinclash/shared';
import { opponentOf, type MatchDoc } from './match/types.js';

const DAY_MS = 86_400_000;

/**
 * Local calendar day number for a Unix-ms time.
 * @param tzOffsetMinutes JavaScript `Date#getTimezoneOffset()` of the viewer (UTC − local, minutes).
 */
export function localDay(ms: number, tzOffsetMinutes: number): number {
  return Math.floor((ms - tzOffsetMinutes * 60_000) / DAY_MS);
}

/** Consecutive days in `days` ending today, or yesterday if nothing was played today yet. */
export function streakFrom(days: ReadonlySet<number>, today: number): number {
  let day = days.has(today) ? today : today - 1;
  let n = 0;
  while (days.has(day)) {
    n++;
    day--;
  }
  return n;
}

const empty = (): { wins: number; losses: number; draws: number } => ({
  wins: 0,
  losses: 0,
  draws: 0,
});

function bump(r: { wins: number; losses: number; draws: number }, doc: MatchDoc, me: string) {
  const res = doc.result!;
  if (res.status === 'draw') r.draws++;
  else if (res.status === 'win' && res.winner === me) r.wins++;
  else r.losses++;
}

/**
 * Stats for every friend `me` has finished a game with, most recently played first.
 * A match counts once the game itself has a result (win or draw), whatever happened to the claim.
 */
export function friendStats(
  docs: readonly MatchDoc[],
  me: string,
  nicknames: ReadonlyMap<string, string>,
  nowMs: number,
  tzOffsetMinutes: number,
): FriendStats[] {
  const byFriend = new Map<
    string,
    {
      days: Set<number>;
      games: number;
      last: number;
      record: { wins: number; losses: number; draws: number };
      byGame: Map<string, { wins: number; losses: number; draws: number }>;
    }
  >();

  for (const doc of docs) {
    const res = doc.result;
    if (!res || (res.status !== 'win' && res.status !== 'draw')) continue;
    const friend = opponentOf(doc, me);
    if (!friend) continue;
    let s = byFriend.get(friend);
    if (!s) {
      s = { days: new Set(), games: 0, last: 0, record: empty(), byGame: new Map() };
      byFriend.set(friend, s);
    }
    // When the game ended (entered SETTLING), not when the claim later landed.
    const finishedAt = doc.transitions.find((t) => t.to === 'SETTLING')?.at ?? doc.updatedAt;
    s.days.add(localDay(finishedAt, tzOffsetMinutes));
    s.games++;
    s.last = Math.max(s.last, finishedAt);
    bump(s.record, doc, me);
    const g = s.byGame.get(doc.gameId) ?? empty();
    bump(g, doc, me);
    s.byGame.set(doc.gameId, g);
  }

  const today = localDay(nowMs, tzOffsetMinutes);
  return [...byFriend.entries()]
    .map(([id, s]): FriendStats => ({
      id,
      nickname: nicknames.get(id) ?? 'Player',
      streakDays: streakFrom(s.days, today),
      gamesPlayed: s.games,
      lastPlayedAt: s.last,
      record: s.record as Record3,
      byGame: Object.fromEntries(s.byGame),
    }))
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}
