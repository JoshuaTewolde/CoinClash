import type { MatchView } from '@coinclash/shared';
import { ButtonLink, Card, formatTimeOfDay } from '../../design/components';
import { useStoreApi } from '../../lib/StoreContext';
import { opponentName } from '../../match/describe';

/** Matches that ended without a game: declined, cancelled (locks timed out), failed. */
export function Ended({ view }: { view: MatchView }) {
  const store = useStoreApi();
  const them = opponentName(view);
  const locked = store.hasLocked(view.id);
  const back = view.locks ? formatTimeOfDay(view.locks.htlcExpiresAt * 1000) : null;

  const copy: Record<string, { title: string; body: string }> = {
    DECLINED: { title: 'Declined', body: `This challenge was declined. No sats moved.` },
    CANCELLED: {
      title: 'Cancelled',
      body: `Both stakes weren’t locked in time, so the game never started.${
        locked && back ? ` Your locked stake returns to your wallet automatically at ${back}.` : ''
      }`,
    },
    EXPIRED: { title: 'Expired', body: 'The claim window closed.' },
    FAILED: {
      title: 'Something went wrong',
      body: 'This match couldn’t continue. No one was charged a fee.',
    },
  };
  const c = copy[view.status] ?? { title: 'Match over', body: '' };

  return (
    <main className="screen">
      <Card raised>
        <span className="eyebrow">Match vs {them}</span>
        <h1>{c.title}</h1>
        <p style={{ margin: 0 }}>{c.body}</p>
      </Card>
      <div className="spacer" />
      <ButtonLink to="/new" variant="primary" size="lg" block>
        New challenge
      </ButtonLink>
      <ButtonLink to="/" block>
        Home
      </ButtonLink>
    </main>
  );
}
