/** /m/:id: one route per match; the stage shown follows the server's match status. */
import type { MatchView } from '@coinclash/shared';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ButtonLink, ErrorText, Loading, Logo } from '../../design/components';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { Ended } from './Ended';
import { GameStage } from './GameStage';
import { InviteSent } from './InviteSent';
import { LockStake } from './LockStake';
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

function Stage({ view }: { view: MatchView }) {
  switch (view.status) {
    case 'PROPOSED':
      return <InviteSent view={view} />;
    case 'NEGOTIATING':
      return <Negotiate view={view} />;
    case 'AWAITING_LOCKS':
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
