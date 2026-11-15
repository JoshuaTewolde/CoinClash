/** Turn push notifications on/off (#4). Shown in Settings, and as a prompt card on Home. */
import { useEffect, useState } from 'react';
import { useStoreApi } from '../lib/StoreContext';
import type { PushState } from '../lib/push';
import { Button, Card } from './components';

export function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    void import('../lib/push')
      .then((m) => m.pushState())
      .then(setState, () => setState('unsupported'));
  }, []);
  return [state, setState];
}

const HELP: Record<PushState, string> = {
  on: 'You’ll get a notification when a friend challenges you or wants a rematch.',
  off: 'Get a notification when a friend challenges you or wants a rematch.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser’s site settings.',
  unsupported:
    'This browser can’t show notifications. On iPhone, add CoinClash to your home screen first.',
  unavailable: 'Notifications aren’t set up on this server yet.',
};

export function NotificationsToggle() {
  const store = useStoreApi();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const flip = async () => {
    setBusy(true);
    try {
      setState(
        state === 'on' ? await store.disableNotifications() : await store.enableNotifications(),
      );
    } catch (err) {
      store.toast(err instanceof Error ? err.message : 'Could not change notifications');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-label="Notifications">
      <span className="eyebrow">Notifications</span>
      <span className="muted">{HELP[state]}</span>
      {(state === 'on' || state === 'off') && (
        <Button
          variant={state === 'on' ? 'plain' : 'accent'}
          busy={busy}
          onClick={() => void flip()}
        >
          {state === 'on' ? 'Turn off notifications' : 'Turn on notifications'}
        </Button>
      )}
    </Card>
  );
}

/** Home prompt: only while notifications are off and could be turned on. */
export function NotificationsPrompt() {
  const store = useStoreApi();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  if (state !== 'off') return null;
  return (
    <Card tone="sun" aria-label="Turn on notifications">
      <strong>Know when friends challenge you</strong>
      <span className="muted">Get a notification for new challenges and rematches.</span>
      <Button
        busy={busy}
        onClick={() => {
          setBusy(true);
          store
            .enableNotifications()
            .then(setState, (err: Error) => store.toast(err.message))
            .finally(() => setBusy(false));
        }}
      >
        Turn on notifications
      </Button>
    </Card>
  );
}
