/** Result (spec §8.6): winner, payout status, Rematch, share. */
import type { MatchView } from '@coinclash/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Amount,
  BoardFrame,
  Button,
  ButtonLink,
  Card,
  CoinBurst,
  ErrorText,
  formatTimeOfDay,
} from '../../design/components';
import { gameMeta } from '../../games/registry';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { opponentName, outcome } from '../../match/describe';
import { shareInvite } from './InviteSent';

const REASONS: Record<string, string> = {
  timeout: 'on time',
  forfeit: 'by forfeit',
  'match-cap': 'at the time limit',
};

export function Result({ view }: { view: MatchView }) {
  const { network } = useSnapshot();
  const store = useStoreApi();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const o = outcome(view);
  const them = opponentName(view);
  const meta = gameMeta(view.gameId);
  const result = view.game?.result;
  const reason = result && result.status !== 'ongoing' ? REASONS[result.reason] : undefined;
  const claimed = view.you !== null && view.claimedBy.includes(view.you);
  const ownBack = view.locks ? formatTimeOfDay(view.locks.htlcExpiresAt * 1000) : null;
  const Board = meta.Board;

  const rematch = async () => {
    setBusy(true);
    setError('');
    try {
      const v = view.rematchId
        ? await store.send('match:subscribe', { matchId: view.rematchId })
        : await store.send('match:rematch', { matchId: view.id });
      navigate(`/m/${v.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a rematch');
      setBusy(false);
    }
  };

  const share = () => {
    const text =
      o === 'won'
        ? `I just beat ${them} at ${meta.name} for ${view.stake.toLocaleString('en-US')} sats on CoinClash`
        : `${meta.name} on CoinClash: ${o === 'draw' ? 'a draw' : `${them} got me this time`}`;
    void shareInvite(window.location.origin, text).then(
      (how) => how === 'copied' && store.toast('Copied'),
      () => undefined,
    );
  };

  const title = o === 'won' ? 'You won!' : o === 'lost' ? `${them} won` : 'Draw';
  const tone = o === 'won' ? 'sun' : o === 'lost' ? undefined : 'paper';

  return (
    <main className="screen">
      <Card raised tone={tone} className="result-hero">
        {o === 'won' && <CoinBurst />}
        <span className="eyebrow">
          {meta.name} vs {them}
        </span>
        <h1>{title}</h1>
        {reason && (
          <span className="muted">{o === 'won' ? `You won ${reason}` : `Decided ${reason}`}</span>
        )}
        {o === 'won' && <Amount sats={view.stake} network={network} size="lg" sign="+" />}
        {o === 'lost' && <Amount sats={view.stake} network={network} size="md" sign="-" />}
      </Card>

      <Card aria-label="Payout">
        <span className="eyebrow">Payout</span>
        {o === 'won' && (
          <>
            <strong data-testid="payout-status">
              {claimed
                ? `Collected ${them}'s ${view.stake.toLocaleString('en-US')} sats`
                : `Collecting ${them}'s stake…`}
            </strong>
            {ownBack && (
              <span className="muted">
                Your own stake unlocks back to your wallet at {ownBack}.
              </span>
            )}
          </>
        )}
        {o === 'lost' && (
          <>
            <strong data-testid="payout-status">{them} collects your stake.</strong>
            <span className="muted">Nothing else to do. Get them next time.</span>
          </>
        )}
        {o === 'draw' && (
          <>
            <strong data-testid="payout-status">
              {claimed ? 'Stakes swapped back. You’re even.' : 'Swapping stakes back…'}
            </strong>
            <span className="muted">
              Each of you collects the other’s lock, so nobody loses anything.
            </span>
          </>
        )}
        {view.status === 'EXPIRED' && (
          <span className="muted">
            The claim window closed. Any unclaimed lock returned to its sender.
          </span>
        )}
      </Card>

      {Board && view.game && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 44 }}>
            Final board
          </summary>
          <BoardFrame>
            <Board view={view.game.view} you={view.you} canMove={false} onMove={() => undefined} />
          </BoardFrame>
        </details>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      <Button variant="primary" size="lg" block busy={busy} onClick={() => void rematch()}>
        Rematch · {view.stake.toLocaleString('en-US')}
      </Button>
      <div className="grid-2">
        <Button onClick={share}>Share</Button>
        <ButtonLink to="/">Home</ButtonLink>
      </div>
    </main>
  );
}
