/**
 * A player's CoinClash money activity for the Wallet history (owner feedback #7): who it was with,
 * which game, and why. Built from the escrow ledger embedded in each match (ADR 0013), so it names
 * the opponent and game, which raw wallet payments can't.
 */
import type { ActivityItem } from '@coinclash/shared';
import { opponentOf, type MatchDoc } from './match/types.js';

export function activityFor(
  me: string,
  docs: readonly MatchDoc[],
  nicknames: ReadonlyMap<string, string>,
  bonus: { paidAt: number | null; amount: number },
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const doc of docs) {
    if (doc.mode !== 'escrow') continue;
    const opp = opponentOf(doc, me);
    const opponent = opp ? (nicknames.get(opp) ?? 'Player') : null;
    const dep = doc.deposits[me];
    if (dep?.paymentId) {
      items.push({
        id: `${doc._id}:stake`,
        at: dep.paidAt ?? doc.updatedAt,
        kind: 'stake',
        direction: 'out',
        amount: doc.stake,
        gameId: doc.gameId,
        opponent,
        matchId: doc._id,
        status: 'done',
      });
    }
    for (const p of Object.values(doc.payouts)) {
      if (p.player !== me) continue;
      const won = doc.result?.status === 'win' && doc.result.winner === me;
      items.push({
        id: `${doc._id}:${p.kind}`,
        at: p.paidAt ?? doc.updatedAt,
        kind: p.kind === 'payout' && won ? 'winnings' : 'refund',
        direction: 'in',
        amount: p.amount,
        gameId: doc.gameId,
        opponent,
        matchId: doc._id,
        status: p.status === 'paid' ? 'done' : p.status,
      });
    }
  }
  if (bonus.paidAt !== null && bonus.amount > 0) {
    items.push({
      id: 'welcome-bonus',
      at: bonus.paidAt,
      kind: 'bonus',
      direction: 'in',
      amount: bonus.amount,
      gameId: null,
      opponent: null,
      matchId: null,
      status: 'done',
    });
  }
  return items.sort((a, b) => b.at - a.at);
}
