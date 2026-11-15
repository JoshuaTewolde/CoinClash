/** Wallet (spec §8.7): balance, receive, history. Send and the regtest faucet link land in Phase 5. */
import { useEffect, useState } from 'react';
import { Amount, Button, Card, ScreenHead } from '../design/components';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import type { WalletTx } from '../wallet/types';

const STATUS: Record<WalletTx['status'], string> = {
  waiting: 'locked',
  claimed: 'paid',
  returned: 'returned',
};

export function Wallet() {
  const { balance, network } = useSnapshot();
  const store = useStoreApi();
  const [address, setAddress] = useState('');
  const [history, setHistory] = useState<WalletTx[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.walletAddress().then(setAddress);
    void store.walletHistory().then(setHistory, () => setHistory([]));
    void store.refreshBalance();
  }, [store, balance]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      store.toast('Address copied');
    } catch {
      store.toast('Could not copy');
    }
  };

  return (
    <main className="screen">
      <ScreenHead title="Wallet" />
      <Card raised aria-label="Balance">
        <span className="eyebrow">Balance</span>
        {balance === null ? (
          <span className="muted">…</span>
        ) : (
          <Amount sats={balance} network={network} size="lg" />
        )}
      </Card>

      <Card aria-label="Receive">
        <span className="eyebrow">Receive</span>
        <code style={{ wordBreak: 'break-all', fontWeight: 700, fontSize: 'var(--cc-text-sm)' }}>
          {address || '…'}
        </code>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button onClick={() => void copy()} disabled={!address}>
            Copy address
          </Button>
          {store.hasFaucet && (
            <Button
              variant="accent"
              busy={busy}
              onClick={() => {
                setBusy(true);
                void store.faucet().finally(() => setBusy(false));
              }}
            >
              Add 10,000 sats
            </Button>
          )}
        </div>
      </Card>

      <section className="stack" aria-labelledby="hist-h">
        <h2 id="hist-h" className="section-title">
          History
        </h2>
        {history === null ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No payments yet.</p>
        ) : (
          history.map((t) => (
            <div key={t.paymentId} className="match-row">
              <span className="match-row__text">
                <strong>{t.direction === 'in' ? 'Lock from a friend' : 'Lock to a friend'}</strong>
                <span>{STATUS[t.status]}</span>
              </span>
              <Amount
                sats={t.amount}
                network={network}
                size="sm"
                sign={t.direction === 'in' ? '+' : '-'}
              />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
