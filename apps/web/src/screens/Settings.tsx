/** Settings (spec §8.8): money mode (ADR 0010), account, passkey backup notice, sign out. */
import { Button, Card, ScreenHead } from '../design/components';
import { NetworkChoices } from '../design/NetworkPicker';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';

export function Settings() {
  const { user } = useSnapshot();
  const store = useStoreApi();
  return (
    <main className="screen">
      <ScreenHead title="Settings" />

      <Card raised aria-label="Money mode">
        <span className="eyebrow">Money mode</span>
        <div
          role="menu"
          aria-label="Money mode"
          className="stack"
          style={{ gap: 'var(--cc-space-1)' }}
        >
          <NetworkChoices />
        </div>
        <span className="muted">
          Test sats are free and worth nothing, which makes them perfect for trying games with
          friends. Real money is coming soon.
        </span>
      </Card>

      <Card aria-label="Account">
        <span className="eyebrow">Account</span>
        <strong>{user?.nickname}</strong>
        <code className="muted" style={{ wordBreak: 'break-all' }}>
          {user?.id}
        </code>
      </Card>

      <Card tone="sun" aria-label="Backup">
        <span className="eyebrow" style={{ color: 'var(--cc-ink)' }}>
          Keep your passkey safe
        </span>
        <p style={{ margin: 0, fontSize: 'var(--cc-text-sm)' }}>
          Your wallet is unlocked by your passkey. It syncs through your Google Password Manager. If
          you lose the passkey, you lose this wallet, and CoinClash can’t recover it.
        </p>
      </Card>

      <div className="spacer" />
      <Button block onClick={() => store.signOut()}>
        Sign out on this device
      </Button>
    </main>
  );
}
