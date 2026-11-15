/**
 * Onboarding: nickname + two buttons, Create account / Sign in (ADR 0003). On regtest/mainnet
 * these become the Breez passkey register/sign-in calls in Phase 5; on mock they make or restore
 * a local test wallet.
 */
import { NicknameSchema } from '@coinclash/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, ErrorText, Logo } from '../design/components';
import { useStoreApi } from '../lib/StoreContext';

export function AuthForm({ children }: { children?: ReactNode }) {
  const store = useStoreApi();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState<'register' | 'signin' | null>(null);
  const [error, setError] = useState('');

  const run = async (kind: 'register' | 'signin', fn: () => Promise<void>) => {
    setError('');
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
      <Button
        variant="plain"
        block
        busy={busy === 'signin'}
        onClick={() => void run('signin', () => store.signIn())}
      >
        I already have an account · Sign in
      </Button>
      <p className="muted center">
        Your wallet is unlocked by a passkey on this device. No seed phrase, no password.
      </p>
    </div>
  );
}

export function Onboarding() {
  return (
    <main className="screen">
      <div className="spacer" />
      <Logo big />
      <h1 style={{ fontSize: 'var(--cc-text-xl)' }}>Play your friends for sats.</h1>
      <Card tone="sun" raised>
        <p style={{ margin: 0 }}>
          Pick a game, set a stake, send a link. You both lock your stake, the winner unlocks both.
          CoinClash never holds your sats.
        </p>
      </Card>
      <AuthForm />
    </main>
  );
}
