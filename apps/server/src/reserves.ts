/**
 * Public escrow report (ADR 0018): what the escrow wallet holds next to what it owes, so anyone
 * can check that every live stake is covered. Pure; the route feeds it repo data and the balance.
 */
import type { EscrowReport } from '@coinclash/shared';
import type { MatchDoc } from './match/types.js';

/** What the escrow owes on one match right now. */
export function owedOn(doc: MatchDoc): number {
  if (doc.mode !== 'escrow') return 0;
  const payouts = Object.values(doc.payouts);
  // Once settling starts, the ledger says exactly what is still to pay.
  if (payouts.length > 0) {
    return payouts.filter((p) => p.status !== 'paid').reduce((n, p) => n + p.amount, 0);
  }
  const paidIn = Object.values(doc.deposits).filter((d) => d.paymentId).length;
  return paidIn * doc.stake;
}

export function escrowReport(
  open: readonly MatchDoc[],
  settled: readonly MatchDoc[],
  balance: number,
  now: number,
): EscrowReport {
  // A match can be both unfinished and have open payouts: count it once.
  const byId = new Map(open.map((d) => [d._id, d]));
  let owed = 0;
  let liveMatches = 0;
  for (const d of byId.values()) {
    const o = owedOn(d);
    owed += o;
    if (o > 0) liveMatches++;
  }
  const recent = settled
    .flatMap((d) =>
      Object.values(d.payouts)
        .filter((p) => p.status === 'paid')
        .map((p) => ({
          at: p.paidAt ?? d.updatedAt,
          gameId: d.gameId,
          kind: p.kind,
          amount: p.amount,
        })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);
  return { balance, owed, liveMatches, recent, at: now };
}
