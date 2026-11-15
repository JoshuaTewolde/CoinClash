/** /m/:id: one route per match; the stage shown follows the server's match status. */
import type { MatchView } from '@coinclash/shared';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ButtonLink, ErrorText, Loading, Logo } from '../../design/components';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { Ended } from './Ended';
import { GameStage } from './GameStage';
import { InviteSent } from './InviteSent';
import { LockStake } from './LockStake';
import { PayStake } from './PayStake';
import { Negotiate } from './Negotiate';
import { Result } from './Result';

export function Match() {
  const { id = '' } = useParams();
  const { matches } = useSnapshot();
  const store = useStoreApi();
  const view = matches[id];
  const [error, setError] = useState('');

  useEffect(() => {
    if (view) return;
    store.send('match:subscribe', { matchId: id }).catch((err: Error) => setError(err.message));
  }, [id, view, store]);

  if (error)
    return (
      <main className="screen">
        <Logo />
        <ErrorText>{error}</ErrorText>
        <ButtonLink to="/" variant="accent" block>
          Go home
        </ButtonLink>
      </main>
    );
  if (!view) return <Loading label="Loading match" />;
  return <Stage view={view} />;
}

/**
 * How long the finished board stays up before the result screen, so the last move lands
 * (the final RPS clash, the winning line). Pool replays its last shot on the result screen.
 */
const FINAL_HOLD_MS: Record<string, number> = { rps: 3800, trivia: 3000, pool: 0 };
const DEFAULT_HOLD_MS = 2000;

/** True for a moment after this screen saw the game end live. */
function useFinalHold(view: MatchView): boolean {
  const prev = useRef(view.status);
  const [hold, setHold] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const ended = prev.current === 'IN_PROGRESS' && view.status !== 'IN_PROGRESS';
    prev.current = view.status;
    const ms = FINAL_HOLD_MS[view.gameId] ?? DEFAULT_HOLD_MS;
    if (!ended || !view.game || ms <= 0) return;
    setHold(true);
    timer.current = setTimeout(() => setHold(false), ms);
  }, [view.status, view.gameId, view.game]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return hold;
}

function Stage({ view }: { view: MatchView }) {
  const hold = useFinalHold(view);
  if (hold) return <GameStage view={view} over />;
  switch (view.status) {
    case 'PROPOSED':
      return <InviteSent view={view} />;
    case 'NEGOTIATING':
      return <Negotiate view={view} />;
    case 'AWAITING_DEPOSITS':
      return <PayStake view={view} />;
    case 'AWAITING_LOCKS':
      // HTLC mode is dormant (ADR 0013); kept so it can be switched back on.
      return <LockStake view={view} />;
    case 'IN_PROGRESS':
      return <GameStage view={view} />;
    case 'SETTLING':
    case 'SETTLED':
    case 'EXPIRED':
      return view.game ? <Result view={view} /> : <Ended view={view} />;
    default:
      return <Ended view={view} />;
  }
}
