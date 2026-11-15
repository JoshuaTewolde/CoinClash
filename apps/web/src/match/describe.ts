/** Viewer-relative wording for a match (Home rows, headers). Pure, so it's unit-tested. */
import { FINAL_STATUSES, type MatchView } from '@coinclash/shared';

export function opponentOf(v: MatchView): { id: string; nickname: string } | null {
  if (v.you === v.challenger.id) return v.opponent;
  return v.challenger;
}

export function opponentName(v: MatchView): string {
  return opponentOf(v)?.nickname ?? 'a friend';
}

export function isFinal(v: MatchView): boolean {
  return FINAL_STATUSES.includes(v.status);
}

export type Outcome = 'won' | 'lost' | 'draw' | null;

export function outcome(v: MatchView): Outcome {
  const r = v.game?.result;
  if (!r || r.status === 'ongoing') return null;
  if (r.status === 'draw') return 'draw';
  return r.winner === v.you ? 'won' : 'lost';
}

export interface MatchLine {
  /** Short status for the row. */
  readonly text: string;
  /** True when the viewer needs to act. */
  readonly hot: boolean;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function describeMatch(v: MatchView, now: number, lockedLocally = false): MatchLine {
  const them = opponentName(v);
  const you = v.you;
  switch (v.status) {
    case 'PROPOSED':
      return { text: 'Invite sent · waiting for a friend to open it', hot: false };
    case 'NEGOTIATING': {
      const last = v.proposals.at(-1);
      return v.respondent === you
        ? { text: `Your call · ${them} offered ${last?.amount.toLocaleString('en-US')}`, hot: true }
        : { text: `Waiting for ${them} to answer`, hot: false };
    }
    case 'AWAITING_LOCKS': {
      const mine = you ? v.locks?.locked[you] : false;
      if (!mine && !lockedLocally) return { text: 'Lock your stake to start', hot: true };
      return { text: `Waiting for ${them} to lock`, hot: false };
    }
    case 'IN_PROGRESS': {
      const myTurn = you !== null && (v.game?.waitingOn.includes(you) ?? false);
      const left = v.game?.turnEndsAt ? ` · ${clock(v.game.turnEndsAt - now)} left` : '';
      return myTurn
        ? { text: `Your turn${left}`, hot: true }
        : { text: `${them}'s turn`, hot: false };
    }
    case 'SETTLING':
    case 'SETTLED':
    case 'EXPIRED': {
      const o = outcome(v);
      if (o === 'won')
        return { text: v.status === 'SETTLING' ? 'You won! Collecting…' : 'You won', hot: false };
      if (o === 'lost') return { text: `${them} won`, hot: false };
      if (o === 'draw') return { text: 'Draw', hot: false };
      return { text: 'Finished', hot: false };
    }
    case 'DECLINED':
      return { text: 'Declined', hot: false };
    case 'CANCELLED':
      return { text: 'Cancelled · stakes weren’t locked in time', hot: false };
    case 'FAILED':
      return { text: 'Something went wrong', hot: false };
  }
}
