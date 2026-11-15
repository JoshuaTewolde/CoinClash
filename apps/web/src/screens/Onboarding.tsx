/**
 * Onboarding: nickname + two buttons, Create account / Sign in (ADR 0003). On regtest/mainnet
 * these are the Breez passkey `register` / `signIn` ceremonies; on mock they make or restore a
 * local test wallet. Returning players see "Welcome back" with one Unlock button, because a
 * passkey wallet can't be reopened without a tap.
 */
import { NicknameSchema } from '@coinclash/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorText, Logo } from '../design/components';
import { browserSupport, supportAdvice, type BrowserSupport } from '../lib/browserSupport';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';

export function AuthForm({ children }: { children?: ReactNode }) {
  const store = useStoreApi();
  const { returning } = useSnapshot();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState<'register' | 'signin' | null>(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(!returning);

  const run = async (kind: 'register' | 'signin', fn: () => Promise<void>) => {
    setError('');
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      // A wallet this server hasn't seen yet needs a nickname: show the field.
      if (/nickname/i.test(message)) setShowNew(true);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const register = (e: FormEvent) => {
    e.preventDefault();
    const parsed = NicknameSchema.safeParse(nickname);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Pick a nickname');
      return;
    }
    void run('register', () => store.register(parsed.data));
  };

  const signIn = () => void run('signin', () => store.signIn(nickname.trim() || undefined));

  if (!showNew && returning) {
    return (
      <div className="stack">
        {children}
        <Card tone="sun" raised>
          <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
            Welcome back
          </span>
          <strong style={{ fontSize: 'var(--cc-text-lg)' }}>{returning}</strong>
        </Card>
        <ErrorText>{error}</ErrorText>
        <Button variant="primary" size="lg" block busy={busy === 'signin'} onClick={signIn}>
          Unlock with passkey
        </Button>
        <Button block onClick={() => setShowNew(true)}>
          Use a different account
        </Button>
      </div>
    );
  }

  return (
    <div className="stack">
      {children}
      <form className="stack" onSubmit={register} noValidate>
        <label className="field">
          Nickname
          <input
            className="input"
            name="nickname"
            autoComplete="nickname"
            maxLength={20}
            placeholder="What friends call you"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" block busy={busy === 'register'}>
          Create account
        </Button>
      </form>
      <Button variant="plain" block busy={busy === 'signin'} onClick={signIn}>
        I already have an account · Sign in
      </Button>
      <p className="muted center">
        Your wallet is unlocked by a passkey on this device. No seed phrase, no password.
      </p>
    </div>
  );
}

/** Warns up front when this browser can't hold a passkey wallet, with a copy-link escape. */
export function BrowserWarning() {
  const { config } = useSnapshot();
  const [support, setSupport] = useState<BrowserSupport>('unknown');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void browserSupport().then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, []);
  const advice = config?.network === 'mock' ? null : supportAdvice(support);
  if (!advice) return null;
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <Card tone="paper" raised aria-label="Browser not supported">
      <strong>Open CoinClash in Chrome</strong>
      <span>{advice}</span>
      <Button onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</Button>
      <span className="muted">You can still try a free practice game here.</span>
    </Card>
  );
}

export function Onboarding() {
  const { returning } = useSnapshot();
  return (
    <main className="screen">
      <div className="spacer" />
      <Logo big />
      {!returning && <h1 style={{ fontSize: 'var(--cc-text-xl)' }}>Play your friends for sats.</h1>}
      {!returning && (
        <Card tone="sun" raised>
          <p style={{ margin: 0 }}>
            Pick a game, set a stake, send a link. Both stakes are secured before the game starts,
            and the winner gets the whole pot instantly.
          </p>
        </Card>
      )}
      <BrowserWarning />
      <AuthForm />
      <Link to="/practice" className="btn btn--block">
        Try a free practice game first
      </Link>
    </main>
  );
}
