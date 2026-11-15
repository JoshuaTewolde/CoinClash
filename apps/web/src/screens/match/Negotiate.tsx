/** Challenge card (spec §8.3): proposal history, Accept / Counter / Take the lower / Decline. */
import type { MatchView } from '@coinclash/shared';
import { useState } from 'react';
import { Amount, Button, ButtonLink, Card, ErrorText } from '../../design/components';
import { gameMeta } from '../../games/registry';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { opponentName } from '../../match/describe';
import { clampStake, StakeInput } from '../StakeInput';

export function Negotiate({ view }: { view: MatchView }) {
  const { network, config } = useSnapshot();
  const store = useStoreApi();
  const [countering, setCountering] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const latest = view.proposals.at(-1);
  const prev = view.proposals.at(-2);
  const [counter, setCounter] = useState(latest?.amount ?? view.stake);
  const them = opponentName(view);
  const myCall = view.respondent === view.you;
  const isChallenger = view.you === view.challenger.id;
  const min = config?.stakeMin ?? 100;
  const max = config?.stakeMax ?? 100_000;
  const amount = latest?.amount ?? view.stake;
  const lower = prev && latest ? Math.min(prev.amount, latest.amount) : null;

  const act = async (name: string, event: string, extra: object = {}) => {
    setBusy(name);
    setError('');
    try {
      await store.send(event, { matchId: view.id, ...extra });
      setCountering(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work');
    } finally {
      setBusy(null);
    }
  };

  const who = (by: string) => (by === view.you ? 'You' : them);

  return (
    <main className="screen screen--tinted">
      <div className="stack">
        <p className="eyebrow">{isChallenger ? 'Your challenge' : 'You’ve been challenged'}</p>
        <h1 style={{ fontSize: '2rem' }}>
          {isChallenger ? `You vs ${them}` : `${them} wants a game of`}{' '}
          <span className="logo__clash" style={{ transform: 'rotate(-2deg)' }}>
            {gameMeta(view.gameId).name}
          </span>
        </h1>
      </div>

      <Card raised aria-label="Proposals">
        <h2 className="eyebrow">Proposals</h2>
        <ol className="proposals">
          {view.proposals.map((p, i) => (
            <li key={i} className={i === view.proposals.length - 1 ? 'is-latest' : undefined}>
              <span>
                {who(p.by)} {i === 0 ? 'proposed' : 'countered'}
              </span>
              <strong>{p.amount.toLocaleString('en-US')}</strong>
            </li>
          ))}
        </ol>
      </Card>

      <Card tone="paper">
        <dl className="facts">
          <div>
            <dt>YOUR STAKE</dt>
            <dd>
              <Amount sats={amount} network={network} size="sm" />
            </dd>
          </div>
          <div>
            <dt>YOU COULD WIN</dt>
            <dd>
              <Amount sats={amount} network={network} size="sm" sign="+" />
            </dd>
          </div>
          <div>
            <dt>NETWORK FEE</dt>
            <dd>≈ 0 sats</dd>
          </div>
          <div>
            <dt>HOUSE FEE</dt>
            <dd>None</dd>
          </div>
        </dl>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />

      {!myCall ? (
        <Card>
          <strong>Waiting for {them} to answer…</strong>
          <span className="muted">You’ll see their reply here as soon as they make it.</span>
        </Card>
      ) : countering ? (
        <Card raised>
          <span className="eyebrow">Your counter</span>
          <StakeInput
            value={counter}
            onChange={setCounter}
            min={min}
            max={max}
            label="Counter in sats"
          />
          <div className="grid-2">
            <Button onClick={() => setCountering(false)}>Cancel</Button>
            <Button
              variant="primary"
              busy={busy === 'counter'}
              disabled={clampStake(counter, min, max) === amount}
              onClick={() =>
                void act('counter', 'match:counter', { amount: clampStake(counter, min, max) })
              }
            >
              Send counter
            </Button>
          </div>
        </Card>
      ) : (
        <div className="stack">
          <Button
            variant="primary"
            size="lg"
            block
            busy={busy === 'accept'}
            onClick={() => void act('accept', 'match:accept')}
          >
            Accept {amount.toLocaleString('en-US')}
          </Button>
          <div className="grid-2">
            {lower !== null ? (
              <Button
                variant="accent"
                busy={busy === 'lower'}
                onClick={() => void act('lower', 'match:takeLower')}
              >
                Take the lower
              </Button>
            ) : (
              <Button
                variant="accent"
                busy={busy === 'decline'}
                onClick={() => void act('decline', 'match:decline')}
              >
                Decline
              </Button>
            )}
            <Button onClick={() => setCountering(true)}>Counter</Button>
          </div>
          {lower !== null && (
            <>
              <span className="center" style={{ fontSize: 'var(--cc-text-sm)' }}>
                Lower of the last two is {lower.toLocaleString('en-US')}
              </span>
              <button
                type="button"
                className="link-btn"
                disabled={busy !== null}
                onClick={() => void act('decline', 'match:decline')}
              >
                Decline this challenge
              </button>
            </>
          )}
        </div>
      )}
      {!myCall && (
        <ButtonLink to="/" block>
          Back home
        </ButtonLink>
      )}
    </main>
  );
}
