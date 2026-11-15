import type { MatchView } from '@coinclash/shared';
import { useState } from 'react';
import { Amount, Button, Card, ScreenHead } from '../../design/components';
import { GameBadge, gameMeta } from '../../games/registry';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';

export function inviteUrl(code: string): string {
  return `${window.location.origin}/i/${code}`;
}

/** Share via the Web Share API, falling back to copying the link. */
export async function shareInvite(url: string, text: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'CoinClash', text, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

export function InviteSent({ view }: { view: MatchView }) {
  const { network } = useSnapshot();
  const store = useStoreApi();
  const [busy, setBusy] = useState(false);
  const name = gameMeta(view.gameId).name;
  const url = inviteUrl(view.inviteCode);

  const share = async () => {
    setBusy(true);
    try {
      const how = await shareInvite(url, `Play me at ${name} for sats on CoinClash`);
      if (how === 'copied') store.toast('Invite link copied');
    } catch {
      store.toast('Could not share. Copy the link below.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <ScreenHead title="Invite a friend" back="/" />
      <Card raised>
        <div className="row">
          <GameBadge id={view.gameId} />
          <div className="stack" style={{ gap: 0 }}>
            <strong>{name}</strong>
            <span className="muted">Your stake</span>
          </div>
        </div>
        <Amount sats={view.stake} network={network} size="lg" />
      </Card>
      <p style={{ margin: 0 }}>
        Send this link to a friend. They can accept your stake, counter it, or take the lower of the
        two.
      </p>
      <Card tone="paper" dashed>
        <span className="eyebrow">Invite link</span>
        <code data-testid="invite-link" style={{ wordBreak: 'break-all', fontWeight: 700 }}>
          {url}
        </code>
      </Card>
      <div className="spacer" />
      <Button variant="primary" size="lg" block busy={busy} onClick={() => void share()}>
        Send invite
      </Button>
      <p className="muted center">This page updates as soon as your friend opens the link.</p>
    </main>
  );
}
