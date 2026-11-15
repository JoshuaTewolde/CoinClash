/** Settings (spec §8.8): money mode (ADR 0010), account, passkey backup notice, sign out. */
import { useState } from 'react';
import { Button, Card, ScreenHead } from '../design/components';
import { NetworkChoices } from '../design/NetworkPicker';
import { NotificationsToggle } from '../design/NotificationsToggle';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import { cue, feedbackEnabled, setFeedbackEnabled } from '../lib/feedback';
import { alwaysAskPasskey, setAlwaysAskPasskey } from '../wallet/vault';

export function Settings() {
  const { user } = useSnapshot();
  const store = useStoreApi();
  const [askEveryTime, setAskEveryTime] = useState(alwaysAskPasskey);
  const [fx, setFx] = useState(feedbackEnabled);
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

      <NotificationsToggle />

      <Card aria-label="Sound and vibration">
        <span className="eyebrow">Sound & vibration</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={fx}
            onChange={(e) => {
              setFx(e.target.checked);
              setFeedbackEnabled(e.target.checked);
              if (e.target.checked) cue('turn');
            }}
          />
          <span>
            <strong>Sounds and vibration</strong>
            <span className="muted" style={{ display: 'block' }}>
              A buzz and a beep when it’s your turn, and when you win or lose.
            </span>
          </span>
        </label>
      </Card>

      <Card aria-label="Security">
        <span className="eyebrow">Security</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={askEveryTime}
            onChange={(e) => {
              setAskEveryTime(e.target.checked);
              void setAlwaysAskPasskey(e.target.checked);
              store.toast(
                e.target.checked
                  ? 'CoinClash will ask for your passkey every time it opens'
                  : 'This device will stay signed in',
              );
            }}
          />
          <span>
            <strong>Ask for my passkey every time</strong>
            <span className="muted" style={{ display: 'block' }}>
              Off: this device stays signed in for up to 30 days. On: unlock with your passkey on
              every open.
            </span>
          </span>
        </label>
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
