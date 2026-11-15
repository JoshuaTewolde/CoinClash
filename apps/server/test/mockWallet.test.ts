import type { AddressInfo } from 'node:net';
import { paymentHashOf } from '@coinclash/rail';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';

type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

describe('mock wallet HTTP routes (NETWORK=mock only)', () => {
  let app: App;
  let base: string;

  const call = async <T>(path: string, body?: unknown): Promise<Reply<T>> => {
    const res = await fetch(`${base}/api/mock-wallet${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as Reply<T>;
  };

  beforeAll(async () => {
    app = createApp(loadConfig({ NETWORK: 'mock', PORT: '0', WELCOME_BONUS_SATS: '5000' }));
    await new Promise<void>((r) => app.http.listen(0, r));
    base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  it('gives new wallets the welcome amount, locks, finds, claims and lists history', async () => {
    const a = 'mock-aaaaaaaa';
    const b = 'mock-bbbbbbbb';
    expect(await call(`/${a}`)).toEqual({ ok: true, data: { id: a, balance: 5000 } });
    await call(`/${b}`);

    const preimage = '11'.repeat(32);
    const paymentHash = paymentHashOf(preimage);
    const locked = await call<{ paymentId: string }>(`/${a}/lock`, {
      to: b,
      amount: 1200,
      paymentHash,
      expirySecs: 600,
    });
    expect(locked.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));

    const incoming = await call<{ amount: number; status: string }>(
      `/${b}/incoming/${paymentHash}`,
    );
    expect(incoming).toMatchObject({ ok: true, data: { amount: 1200, status: 'waiting' } });

    expect(await call(`/${b}/claim`, { preimage })).toMatchObject({
      ok: true,
      data: { amount: 1200 },
    });
    expect(await call(`/${b}`)).toMatchObject({ data: { balance: 6200 } });
    expect(await call(`/${a}`)).toMatchObject({ data: { balance: 3800 } });

    const hist = await call<{ direction: string; status: string }[]>(`/${a}/history`);
    expect(hist).toMatchObject({ ok: true, data: [{ direction: 'out', status: 'claimed' }] });

    expect(await call(`/${a}/faucet`, {})).toMatchObject({ data: { balance: 13800 } });
  });

  it('rejects bad ids and bad bodies', async () => {
    expect(await call('/not-a-wallet')).toEqual({ ok: false, error: 'Invalid request' });
    const bad = await call('/mock-cccccccc/lock', { to: 'x', amount: -1 });
    expect(bad.ok).toBe(false);
    const broke = await call('/mock-dddddddd/lock', {
      to: 'mock-eeeeeeee',
      amount: 999_999,
      paymentHash: 'ab'.repeat(32),
      expirySecs: 60,
    });
    expect(broke).toEqual({ ok: false, error: 'Insufficient funds' });
  });

  it('is not mounted outside mock', async () => {
    const real = createApp(
      loadConfig({ NETWORK: 'regtest', PORT: '0', SESSION_SECRET: 'x'.repeat(40) }),
    );
    await new Promise<void>((r) => real.http.listen(0, r));
    const port = (real.http.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/mock-wallet/mock-aaaaaaaa`);
    expect(res.status).toBe(404);
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    expect(cfg).toMatchObject({ network: 'regtest', networks: ['regtest'] });
    await real.close();
  });
});
