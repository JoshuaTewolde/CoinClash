/**
 * Invite link landing (/i/:code). Shows who challenged you before sign-in; once signed in,
 * joins the match and opens it.
 */
import type { InvitePreview } from '@coinclash/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Amount, ButtonLink, Card, ErrorText, Loading, Logo } from '../design/components';
import { api } from '../lib/api';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import { AuthForm } from './Onboarding';

export function Invite() {
  const { code = '' } = useParams();
  const { phase, network } = useSnapshot();
  const store = useStoreApi();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');
  const joining = useRef(false);

  useEffect(() => {
    api.invite(code).then(setPreview, (err: Error) => setError(err.message));
  }, [code]);

  useEffect(() => {
    if (phase !== 'ready' || joining.current) return;
    joining.current = true;
    (async () => {
      await store.refreshMatches();
      // Already in this match (e.g. the challenger opened their own link)? Just open it.
      const mine = Object.values(store.getSnapshot().matches).find((m) => m.inviteCode === code);
      const v = mine ?? (await store.send('match:join', { inviteCode: code }));
      navigate(`/m/${v.id}`, { replace: true });
    })().catch((err: Error) => setError(err.message));
  }, [phase, code, store, navigate]);

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

  if (!preview || phase === 'loading' || phase === 'ready')
    return <Loading label="Opening invite" />;

  return (
    <main className="screen screen--tinted">
      <div className="stack">
        <p className="eyebrow">You’ve been challenged</p>
        <h1 style={{ fontSize: '2.1rem' }}>
          {preview.challenger} wants a game of{' '}
          <span className="logo__clash" style={{ transform: 'rotate(-2deg)' }}>
            {preview.gameName}
          </span>
        </h1>
      </div>
      <Card raised>
        <span className="eyebrow">Proposed stake</span>
        <Amount sats={preview.stake} network={network} size="md" />
        <span className="muted">You can accept it, counter, or take the lower.</span>
      </Card>
      <Card>
        <AuthForm>
          <p style={{ margin: 0, fontWeight: 700 }}>
            Make an account to answer. It takes a second.
          </p>
        </AuthForm>
      </Card>
    </main>
  );
}
