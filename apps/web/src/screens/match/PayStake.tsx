/** "Pay your stake" (escrow, ADR 0013): one tap pays this player's deposit from the in-app wallet. */
import type { MatchView } from '@coinclash/shared';
import { useState } from 'react';
import {
  Amount,
  Button,
  Card,
  ClockIcon,
  ErrorText,
  LockIcon,
  SecuredBadge,
  Timer,
} from '../../design/components';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { opponentOf } from '../../match/describe';

export function PayStake({ view }: { view: MatchView }) {
  const { network, balance } = useSnapshot();
  const store = useStoreApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const escrow = view.escrow!;
  const opp = opponentOf(view);
  const them = opp?.nickname ?? 'Your friend';
  const paidMine = view.you ? escrow.paid[view.you] : false;
  const paidTheirs = opp ? escrow.paid[opp.id] : false;
  const sentMine = paidMine || store.hasLocked(view.id);
  const short = balance !== null && balance < view.stake;
  const stake = view.stake.toLocaleString('en-US');

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      await store.payStake(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pay your stake');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '2.1rem' }}>Pay your stake</h1>
        <Timer deadline={escrow.deadline} />
      </div>

      <Card raised aria-label="Pot" className="center">
        <span className="eyebrow">Winner takes</span>
        <Amount sats={view.stake * 2} network={network} size="lg" />
        <span className="muted">{stake} each</span>
      </Card>

      <div className="grid-2">
        <Card className={`lock-card${paidMine ? ' lock-card--done' : ''}`}>
          <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
            You
          </span>
          {paidMine ? <LockIcon /> : sentMine ? <ClockIcon /> : <LockIcon open />}
          <strong>{paidMine ? 'Secured' : sentMine ? 'Confirming…' : 'Not yet'}</strong>
        </Card>
        <Card dashed className={`lock-card${paidTheirs ? ' lock-card--done' : ''}`}>
          <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
            {them}
          </span>
          {paidTheirs ? <LockIcon /> : <ClockIcon />}
          <strong>{paidTheirs ? 'Secured' : 'Waiting…'}</strong>
        </Card>
      </div>

      <Card>
        <SecuredBadge />
        <p style={{ margin: 0, fontSize: 'var(--cc-text-sm)' }}>
          The game starts the moment both stakes are in. The winner gets the whole pot instantly. If{' '}
          {them} doesn’t pay in time, your stake comes straight back.
        </p>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      {sentMine ? (
        <Card className="center">
          <strong>{paidMine ? `Game starts when ${them} pays` : 'Confirming your payment…'}</strong>
        </Card>
      ) : (
        <Button
          variant="primary"
          size="lg"
          block
          busy={busy}
          disabled={short || !escrow.yourInvoice}
          onClick={() => void pay()}
        >
          {escrow.yourInvoice ? `Pay ${stake} from wallet` : 'Getting ready…'}
        </Button>
      )}
      <span className="muted center">
        {short ? 'Not enough in your wallet. ' : ''}Wallet balance{' '}
        {balance === null ? '…' : `${balance.toLocaleString('en-US')} sats`}
      </span>
    </main>
  );
}
