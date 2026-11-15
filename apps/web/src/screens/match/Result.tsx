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
  SecuredBadge,
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
  const { network, matches } = useSnapshot();
  const store = useStoreApi();
  const navigate = useNavigate();
  // A rematch either player offered. The server pushes it to both players the moment it's made.
  const rematchView = view.rematchId ? matches[view.rematchId] : undefined;
  const theyOffered = Boolean(view.rematchId) && rematchView?.challenger.id !== view.you;
  const youOffered = Boolean(view.rematchId) && rematchView?.challenger.id === view.you;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const o = outcome(view);
  const them = opponentName(view);
  const meta = gameMeta(view.gameId);
  const result = view.game?.result;
  const reason = result && result.status !== 'ongoing' ? REASONS[result.reason] : undefined;
  const escrow = view.mode === 'escrow' ? view.escrow : null;
  const myPayout = escrow?.payouts.find((p) => p.player === view.you && p.kind === 'payout');
  // Escrow: paid when the payout to me landed. HTLC (dormant): when I confirmed my claim.
  const claimed = escrow
    ? myPayout?.status === 'paid'
    : view.you !== null && view.claimedBy.includes(view.you);
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
        {o === 'won' && escrow && (
          <>
            <strong data-testid="payout-status">
              {claimed
                ? `Paid +${(view.stake * 2).toLocaleString('en-US')} sats to your wallet`
                : 'Sending the pot to your wallet…'}
            </strong>
            <SecuredBadge />
          </>
        )}
        {o === 'won' && !escrow && (
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
            <strong data-testid="payout-status">
              {escrow ? `${them} takes the pot.` : `${them} collects your stake.`}
            </strong>
            <span className="muted">Nothing else to do. Get them next time.</span>
          </>
        )}
        {o === 'draw' && escrow && (
          <>
            <strong data-testid="payout-status">
              {claimed ? 'Your stake is back in your wallet.' : 'Returning your stake…'}
            </strong>
            <span className="muted">A draw: nobody wins, nobody loses.</span>
          </>
        )}
        {o === 'draw' && !escrow && (
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
        <details open={view.gameId === 'pool'}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 44 }}>
            Final board
          </summary>
          <BoardFrame>
            <Board
              view={view.game.view}
              you={view.you}
              canMove={false}
              onMove={() => undefined}
              mode="review"
            />
          </BoardFrame>
        </details>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      {theyOffered && (
        <Card tone="sun" raised aria-label="Rematch offer" className="rematch-offer">
          <strong>{them} wants a rematch!</strong>
          <span className="muted">
            Same game, {view.stake.toLocaleString('en-US')} sats each. Accept, counter or pass.
          </span>
        </Card>
      )}
      <Button variant="primary" size="lg" block busy={busy} onClick={() => void rematch()}>
        {theyOffered
          ? `Answer ${them}'s rematch`
          : youOffered
            ? `Rematch offered · waiting for ${them}`
            : `Rematch · ${view.stake.toLocaleString('en-US')}`}
      </Button>
      <div className="grid-2">
        <Button onClick={share}>Share</Button>
        <ButtonLink to="/">Home</ButtonLink>
      </div>
    </main>
  );
}
