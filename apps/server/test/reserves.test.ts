/** Public escrow report (ADR 0018). */
import type { AddressInfo } from 'node:net';
import type { EscrowRail } from '@coinclash/rail';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryMatchRepo } from '../src/db/repos.js';
import type { MatchDoc, Payout } from '../src/match/types.js';
import { escrowReport, owedOn } from '../src/reserves.js';
import { newDoc } from './helpers.js';

const paid = { invoice: 'inv', paymentId: 'p', paidAt: 1 };
const unpaid = { invoice: 'inv', paymentId: null, paidAt: null };
const payout = (over: Partial<Payout>): Payout => ({
  player: 'alice',
  kind: 'payout',
  amount: 4000,
  status: 'pending',
  paymentId: null,
  attempts: 0,
  lastError: null,
  ...over,
});

function doc(id: string, patch: Partial<MatchDoc>): MatchDoc {
  return { ...newDoc({ id, mode: 'escrow' }), ...patch };
}

describe('escrow report', () => {
  it('counts paid-in stakes, then the unpaid ledger once settling starts', () => {
    expect(owedOn(doc('a', { deposits: { alice: paid, bob: unpaid } }))).toBe(2000);
    expect(
      owedOn(
        doc('b', {
          deposits: { alice: paid, bob: paid },
          payouts: { 'payout:alice': payout({}) },
        }),
      ),
    ).toBe(4000);
    expect(
      owedOn(doc('c', { payouts: { 'payout:alice': payout({ status: 'paid', paidAt: 5 }) } })),
    ).toBe(0);
    expect(owedOn({ ...newDoc({ id: 'h' }), deposits: { alice: paid } })).toBe(0); // htlc mode
  });

  it('dedupes matches, counts live ones and lists recent paid payouts newest first', () => {
    const live = doc('a', { deposits: { alice: paid, bob: paid } });
    const settled = doc('s', {
      status: 'SETTLED',
      gameId: 'connect4',
      payouts: {
        'payout:alice': payout({ status: 'paid', paidAt: 10 }),
        'refund:bob': payout({ kind: 'refund', amount: 100, status: 'paid', paidAt: 20 }),
        'payout:x': payout({ status: 'failed' }),
      },
    });
    const r = escrowReport([live, live, doc('z', {})], [settled], 5000, 99);
    expect(r).toMatchObject({ balance: 5000, owed: 4000, liveMatches: 1, at: 99 });
    expect(r.recent).toEqual([
      { at: 20, gameId: 'connect4', kind: 'refund', amount: 100 },
      { at: 10, gameId: 'connect4', kind: 'payout', amount: 4000 },
    ]);
  });

  it('GET /api/escrow serves the report, and 503s if the wallet is down', async () => {
    const matches = new MemoryMatchRepo();
    await matches.insert(doc('a', { deposits: { alice: paid, bob: unpaid } }));
    const ok = createApp(loadConfig({ NETWORK: 'mock', PORT: '0' }), { matches });
    await new Promise<void>((r) => ok.http.listen(0, r));
    const base = `http://127.0.0.1:${(ok.http.address() as AddressInfo).port}`;
    const body = await (await fetch(`${base}/api/escrow`)).json();
    expect(body).toMatchObject({ balance: 0, owed: 2000, liveMatches: 1, recent: [] });
    await ok.close();

    const broken = {
      balance: () => Promise.reject(new Error('down')),
      onInvoicePaid: () => () => undefined,
    } as unknown as EscrowRail;
    const bad = createApp(loadConfig({ NETWORK: 'mock', PORT: '0' }), { escrow: broken });
    await new Promise<void>((r) => bad.http.listen(0, r));
    const port = (bad.http.address() as AddressInfo).port;
    const silence = console.error;
    console.error = () => undefined;
    expect((await fetch(`http://127.0.0.1:${port}/api/escrow`)).status).toBe(503);
    console.error = silence;
    await bad.close();
  });
});

describe('GET /api/rate', () => {
  it('serves the Breez BTC/USD rate, or null when unknown or failing', async () => {
    const serve = async (btcUsdRate?: () => Promise<number | null>) => {
      const a = createApp(loadConfig({ NETWORK: 'mock', PORT: '0' }), { btcUsdRate });
      await new Promise<void>((r) => a.http.listen(0, r));
      const port = (a.http.address() as AddressInfo).port;
      const body = await (await fetch(`http://127.0.0.1:${port}/api/rate`)).json();
      await a.close();
      return body;
    };
    expect(await serve(async () => 97_000)).toEqual({ usd: 97_000 });
    expect(await serve()).toEqual({ usd: null });
    const silence = console.error;
    console.error = () => undefined;
    expect(await serve(() => Promise.reject(new Error('x')))).toEqual({ usd: null });
    console.error = silence;
  });
});
