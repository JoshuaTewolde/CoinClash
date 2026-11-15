/** Wallet (spec §8.7): balance, receive, send, history, and the faucet on regtest. */
import { useEffect, useState, type FormEvent } from 'react';
import { Amount, Button, Card, ErrorText, ScreenHead } from '../design/components';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import type { ActivityItem } from '@coinclash/shared';
import { GameBadge, gameMeta } from '../games/registry';
import type { WalletTx } from '../wallet/types';
import { clampStake, parseStake } from './StakeInput';

/** One history line: CoinClash activity (names + game) or a plain wallet payment. */
interface HistoryRow {
  readonly id: string;
  readonly at: number;
  readonly title: string;
  readonly detail: string;
  readonly direction: 'in' | 'out';
  readonly amount: number;
  readonly gameId: string | null;
  readonly icon: 'game' | 'gift' | 'chain' | 'send';
}

const when = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function fromActivity(a: ActivityItem): HistoryRow {
  const vs = a.opponent ? ` · ${a.opponent}` : '';
  const game = a.gameId ? gameMeta(a.gameId).name : '';
  const title =
    a.kind === 'winnings'
      ? `Won vs ${a.opponent ?? 'a friend'}`
      : a.kind === 'stake'
        ? `Stake vs ${a.opponent ?? 'a friend'}`
        : a.kind === 'refund'
          ? `Stake returned${vs}`
          : 'Welcome bonus';
  const status =
    a.status === 'pending' ? ' · sending…' : a.status === 'failed' ? ' · retrying' : '';
  return {
    id: a.id,
    at: a.at,
    title,
    detail: `${game ? `${game} · ` : ''}${when(a.at)}${status}`,
    direction: a.direction,
    amount: a.amount,
    gameId: a.gameId,
    icon: a.gameId ? 'game' : 'gift',
  };
}

function HistoryIcon({ row }: { row: HistoryRow }) {
  if (row.icon === 'game' && row.gameId) return <GameBadge id={row.gameId} />;
  const path =
    row.icon === 'gift'
      ? 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0'
      : row.icon === 'chain'
        ? 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1'
        : 'M4 12h14M13 6l6 6-6 6';
  return (
    <span className="game-badge" style={{ background: 'var(--cc-paper)' }}>
      <svg
        className="game-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cc-ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    </span>
  );
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
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const faucetUrl = network === 'regtest' ? import.meta.env.VITE_REGTEST_FAUCET_URL : undefined;

  useEffect(() => {
    void store.walletAddress().then(setAddress);
    // CoinClash activity names the friend and game. Raw wallet entries add what happened outside
    // the app: faucet deposits and sends you made yourself.
    void Promise.all([
      store.activity().catch(() => [] as ActivityItem[]),
      store.walletHistory().catch(() => [] as WalletTx[]),
    ]).then(([activity, wallet]) => {
      const sent = store.manualSends();
      const extra: HistoryRow[] = [
        ...wallet
          .filter((t) => t.kind === 'deposit')
          .map((t) => ({
            id: t.paymentId,
            at: t.expiresAt * 1000,
            title: 'Deposit from the faucet',
            detail: when(t.expiresAt * 1000),
            direction: 'in' as const,
            amount: t.amount,
            gameId: null,
            icon: 'chain' as const,
          })),
        ...sent.map((t) => ({
          id: `send-${t.at}`,
          at: t.at,
          title: 'Sent',
          detail: `to ${t.to.slice(0, 14)}… · ${when(t.at)}`,
          direction: 'out' as const,
          amount: t.amount,
          gameId: null,
          icon: 'send' as const,
        })),
      ];
      setHistory([...activity.map(fromActivity), ...extra].sort((a, b) => b.at - a.at));
    });
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
        <span className="eyebrow">Receive · your CoinClash address</span>
        <span className="muted">Friends and other Spark wallets send sats here.</span>
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
            The faucet only sends on-chain bitcoin, so it needs your wallet’s Bitcoin deposit
            address (also yours alone). Paste it into the free faucet; the sats land here once the
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
            <div key={t.id} className="match-row">
              <HistoryIcon row={t} />
              <span className="match-row__text">
                <strong>{t.title}</strong>
                <span>{t.detail}</span>
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
