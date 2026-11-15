/** "Lock your stake" (spec §8.4, ADR 0002): one tap locks the stake to the opponent. */
import type { MatchView } from '@coinclash/shared';
import { useState } from 'react';
import {
  Amount,
  Button,
  Card,
  ClockIcon,
  ErrorText,
  formatTimeOfDay,
  LockIcon,
  Timer,
} from '../../design/components';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { opponentOf } from '../../match/describe';

export function LockStake({ view }: { view: MatchView }) {
  const { network, balance } = useSnapshot();
  const store = useStoreApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locks = view.locks!;
  const opp = opponentOf(view);
  const them = opp?.nickname ?? 'Your friend';
  const confirmedMine = view.you ? locks.locked[view.you] : false;
  const confirmedTheirs = opp ? locks.locked[opp.id] : false;
  const sentMine = confirmedMine || store.hasLocked(view.id);
  const short = balance !== null && balance < view.stake;

  const lock = async () => {
    setBusy(true);
    setError('');
    try {
      await store.lock(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not lock your stake');
    } finally {
      setBusy(false);
    }
  };

  const stake = view.stake.toLocaleString('en-US');

  return (
    <main className="screen">
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '2.1rem' }}>Lock your stake</h1>
        <Timer deadline={locks.lockDeadline} />
      </div>

      <Card raised aria-label="Pot" className="center">
        <span className="eyebrow">Winner takes</span>
        <Amount sats={view.stake * 2} network={network} size="lg" />
        <span className="muted">{stake} each</span>
      </Card>

      <div className="grid-2">
        <Card className={`lock-card${sentMine ? ' lock-card--done' : ''}`}>
          <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
            You
          </span>
          <LockIcon open={!sentMine} />
          <strong>{confirmedMine ? 'Locked' : sentMine ? 'Sent' : 'Not yet'}</strong>
        </Card>
        <Card dashed className={`lock-card${confirmedTheirs ? ' lock-card--done' : ''}`}>
          <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
            {them}
          </span>
          {confirmedTheirs ? <LockIcon /> : <ClockIcon />}
          <strong>{confirmedTheirs ? 'Locked' : 'Waiting…'}</strong>
        </Card>
      </div>

      <Card>
        <p style={{ margin: 0, fontSize: 'var(--cc-text-sm)' }}>
          Your {stake} is locked to {them}, and only the winning code can unlock it. If the game
          never starts, it{' '}
          <strong>
            returns to you automatically at {formatTimeOfDay(locks.htlcExpiresAt * 1000)}
          </strong>
          .
        </p>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      {sentMine ? (
        <Card className="center">
          <strong>Game starts when {them} locks</strong>
        </Card>
      ) : (
        <Button
          variant="primary"
          size="lg"
          block
          busy={busy}
          disabled={short}
          onClick={() => void lock()}
        >
          Lock {stake} from wallet
        </Button>
      )}
      <span className="muted center">
        {short ? 'Not enough in your wallet. ' : ''}Wallet balance{' '}
        {balance === null ? '…' : `${balance.toLocaleString('en-US')} sats`}
      </span>
    </main>
  );
}
