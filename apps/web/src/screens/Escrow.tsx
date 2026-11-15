/**
 * Public escrow page (ADR 0018): the escrow wallet's live balance next to what it owes, so anyone
 * can see every live stake is covered. Linked from "Secured by CoinClash".
 */
import type { EscrowReport } from '@coinclash/shared';
import { useEffect, useState } from 'react';
import {
  Amount,
  Card,
  ErrorText,
  Loading,
  ScreenHead,
  formatTimeOfDay,
} from '../design/components';
import { GameBadge, gameMeta } from '../games/registry';
import { api } from '../lib/api';
import { useSnapshot } from '../lib/StoreContext';

export function Escrow() {
  const { network } = useSnapshot();
  const [report, setReport] = useState<EscrowReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      api.escrow().then(
        (r) => live && (setReport(r), setError('')),
        (err: Error) => live && setError(err.message),
      );
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const covered = report ? report.balance >= report.owed : false;

  return (
    <main className="screen">
      <ScreenHead title="The escrow" back />
      <Card tone="sun" raised>
        <p style={{ margin: 0 }}>
          When a match starts, both stakes go to the CoinClash escrow wallet on Spark (by Breez).
          The winner is paid from it the moment the game ends. This page shows, live, that the
          escrow holds at least everything it owes.
        </p>
      </Card>

      <ErrorText>{error}</ErrorText>
      {!report && !error && <Loading label="Checking the escrow" />}

      {report && (
        <>
          <div className="grid-2">
            <Card raised aria-label="Escrow balance">
              <span className="eyebrow">Held</span>
              <Amount sats={report.balance} network={network} size="md" />
            </Card>
            <Card raised aria-label="Owed to players">
              <span className="eyebrow">Owed</span>
              <Amount sats={report.owed} network={network} size="md" />
              <span className="muted">
                {report.liveMatches} live {report.liveMatches === 1 ? 'match' : 'matches'}
              </span>
            </Card>
          </div>
          <Card tone={covered ? 'teal' : undefined} aria-label="Coverage">
            <strong>{covered ? '✓ Fully covered' : '⚠ Not fully covered right now'}</strong>
            <span className="muted">
              Checked at {formatTimeOfDay(report.at)}. Anything above what’s owed is network fee
              headroom.
            </span>
          </Card>

          <section className="stack" aria-labelledby="paid-h">
            <h2 id="paid-h" className="section-title">
              Recent payouts
            </h2>
            {report.recent.length === 0 ? (
              <p className="muted">No payouts yet.</p>
            ) : (
              report.recent.map((p, i) => (
                <div key={i} className="match-row">
                  <GameBadge id={p.gameId} />
                  <span className="match-row__text">
                    <strong>
                      {p.kind === 'payout' ? 'Winner paid' : 'Refund'} · {gameMeta(p.gameId).name}
                    </strong>
                    <span>{formatTimeOfDay(p.at)}</span>
                  </span>
                  <span className="pill">
                    <Amount sats={p.amount} network={network} size="sm" />
                  </span>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
