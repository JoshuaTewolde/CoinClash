/** Wallet (spec §8.7): balance, receive, send, history, and the faucet on regtest. */
import { useEffect, useState, type FormEvent } from 'react';
import { Amount, Button, Card, ErrorText, ScreenHead } from '../design/components';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import type { WalletTx } from '../wallet/types';
import { clampStake, parseStake } from './StakeInput';

const STATUS: Record<WalletTx['status'], string> = {
  waiting: 'locked',
  claimed: 'collected',
  returned: 'returned',
  completed: 'done',
  pending: 'pending',
  failed: 'failed',
};

function txTitle(t: WalletTx): string {
  if (t.kind === 'deposit') return 'Deposit';
  if (t.kind === 'lock') return t.direction === 'in' ? 'Stake locked to you' : 'Stake you locked';
  return t.direction === 'in' ? 'Received' : 'Sent';
}

function SendForm() {
  const store = useStoreApi();
  const { balance } = useSnapshot();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const sats = clampStake(amount, 1, balance ?? 0);
    if (!to.trim() || !amount) return setError('Enter an address and an amount');
    setBusy(true);
    try {
      await store.sendSats(to, sats);
      setTo('');
      setAmount(0);
      store.toast(`Sent ${sats.toLocaleString('en-US')} sats`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <label className="field">
        Spark address
        <input
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="sparkrt1…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        Amount (sats)
        <input
          className="input"
          inputMode="numeric"
          value={amount ? amount.toLocaleString('en-US') : ''}
          onChange={(e) => setAmount(parseStake(e.target.value))}
        />
      </label>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="accent" busy={busy}>
        Send
      </Button>
    </form>
  );
}

export function Wallet() {
  const { balance, network } = useSnapshot();
  const store = useStoreApi();
  const [address, setAddress] = useState('');
  const [deposit, setDeposit] = useState('');
  const [history, setHistory] = useState<WalletTx[] | null>(null);
  const [busy, setBusy] = useState(false);
  const faucetUrl = network === 'regtest' ? import.meta.env.VITE_REGTEST_FAUCET_URL : undefined;

  useEffect(() => {
    void store.walletAddress().then(setAddress);
    void store.walletHistory().then(setHistory, () => setHistory([]));
  }, [store, balance]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      store.toast(`${what} copied`);
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
          <Button onClick={() => void copy(address, 'Address')} disabled={!address}>
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

      {faucetUrl && store.hasDepositAddress && (
        <Card tone="paper" aria-label="Get test sats">
          <span className="eyebrow">Need more test sats?</span>
          <span style={{ fontSize: 'var(--cc-text-sm)' }}>
            Get a deposit address, paste it into the free faucet, and the sats land here once the
            deposit confirms (a few minutes).
          </span>
          {deposit && (
            <code
              style={{ wordBreak: 'break-all', fontWeight: 700, fontSize: 'var(--cc-text-sm)' }}
            >
              {deposit}
            </code>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {deposit ? (
              <Button onClick={() => void copy(deposit, 'Deposit address')}>Copy</Button>
            ) : (
              <Button onClick={() => void store.depositAddress().then(setDeposit)}>
                Get deposit address
              </Button>
            )}
            <a className="btn btn--accent" href={faucetUrl} target="_blank" rel="noreferrer">
              Open faucet
            </a>
          </div>
        </Card>
      )}

      {store.canSend && (
        <Card aria-label="Send">
          <span className="eyebrow">Send</span>
          <SendForm />
        </Card>
      )}

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
                <strong>{txTitle(t)}</strong>
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
