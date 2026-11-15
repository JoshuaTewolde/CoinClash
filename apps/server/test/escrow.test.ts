/**
 * Custodial escrow (ADR 0013): pure machine transitions, the service against the mock escrow
 * with injected faults, crash recovery, and a property test that money out never exceeds money in.
 */
import { MockEscrow, MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { MemoryMatchRepo, MemoryUserRepo } from '../src/db/repos.js';
import { games } from '../src/games.js';
import { applyCommand, type MatchCommand } from '../src/match/machine.js';
import { MatchService } from '../src/match/service.js';
import type { MatchDoc } from '../src/match/types.js';
import { viewFor } from '../src/match/view.js';
import { CONFIG, env, newDoc, run, T0 } from './helpers.js';

const plugin = games.get('tictactoe')!;

/** A NEGOTIATING escrow match accepted at 1000 sats. */
function agreed(): MatchDoc {
  return run(newDoc({ mode: 'escrow', stake: 1000 }), [
    { type: 'join', player: 'bob' },
    { type: 'accept', player: 'bob' },
  ]).doc;
}

function playToWin(doc: MatchDoc): MatchDoc {
  // Whoever moves first wins down the top row.
  let cur = doc;
  for (const cell of [0, 3, 1, 4, 2]) {
    const mover = cur.session!.state as { players: string[]; turn: number };
    const player = mover.players[mover.turn]!;
    cur = applyCommand(cur, { type: 'move', player, move: { cell } }, env(T0)).doc;
  }
  return cur;
}

describe('escrow state machine', () => {
  it('agreement waits for deposits; invoices are recorded once per player', () => {
    const doc = agreed();
    expect(doc.status).toBe('AWAITING_DEPOSITS');
    expect(doc.secrets).toBeNull();
    expect(doc.lockDeadline).toBe(T0 + CONFIG.lockTimeoutMs);
    expect(Object.keys(doc.deposits).sort()).toEqual(['alice', 'bob']);
    const issued = run(doc, [
      { type: 'invoicesIssued', invoices: { alice: 'inv-a', bob: 'inv-b' } },
      { type: 'invoicesIssued', invoices: { alice: 'inv-a2' } },
    ]).doc;
    expect(issued.deposits.alice!.invoice).toBe('inv-a');
    expect(issued.invoices).toEqual(['inv-a', 'inv-b']);
  });

  it('starts the game once both deposits arrive, ignoring duplicates', () => {
    const doc = run(agreed(), [
      { type: 'depositReceived', player: 'alice', paymentId: 'p1', amount: 1000 },
      { type: 'depositReceived', player: 'alice', paymentId: 'p1-dup', amount: 1000 },
    ]).doc;
    expect(doc.status).toBe('AWAITING_DEPOSITS');
    expect(doc.deposits.alice!.paymentId).toBe('p1');
    const started = run(doc, [
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.transitions.at(-1)!.cause).toBe('both stakes secured');
    expect(() =>
      run(started, [{ type: 'depositReceived', player: 'eve', paymentId: 'x', amount: 1 }]),
    ).toThrow(/No deposit expected/);
  });

  it('a win pays the whole pot to the winner; SETTLED once paid', () => {
    const playing = run(agreed(), [
      { type: 'depositReceived', player: 'alice', paymentId: 'p1', amount: 1000 },
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    const settling = playToWin(playing);
    expect(settling.status).toBe('SETTLING');
    const [entry] = Object.entries(settling.payouts);
    const [key, payout] = entry!;
    expect(payout).toMatchObject({ kind: 'payout', amount: 2000, status: 'pending' });
    expect(settling.payoutsOpen).toBe(true);

    const failed = run(settling, [{ type: 'payoutResult', key, ok: false, error: 'boom' }]).doc;
    expect(failed.payouts[key]).toMatchObject({ status: 'failed', attempts: 1, lastError: 'boom' });
    expect(failed.status).toBe('SETTLING');
    const paid = run(failed, [
      { type: 'payoutResult', key, ok: true, paymentId: 'out-1' },
      { type: 'payoutResult', key, ok: true, paymentId: 'out-dup' },
    ]).doc;
    expect(paid.status).toBe('SETTLED');
    expect(paid.payouts[key]).toMatchObject({ status: 'paid', paymentId: 'out-1' });
    expect(paid.payoutsOpen).toBe(false);
    expect(() => run(paid, [{ type: 'payoutResult', key: 'nope', ok: true }])).toThrow(
      /Unknown payout/,
    );
  });

  it('a draw returns each stake', () => {
    const playing = run(agreed(), [
      { type: 'depositReceived', player: 'alice', paymentId: 'p1', amount: 1000 },
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    let cur = playing;
    // X: 0 1 5 6 8 / O: 2 3 4 7 → full board, no line.
    for (const cell of [0, 2, 1, 3, 5, 4, 6, 7, 8]) {
      const s = cur.session!.state as { players: string[]; turn: number };
      cur = applyCommand(
        cur,
        { type: 'move', player: s.players[s.turn]!, move: { cell } },
        env(T0),
      ).doc;
    }
    expect(cur.result).toMatchObject({ status: 'draw' });
    expect(
      Object.values(cur.payouts)
        .map((p) => [p.player, p.amount])
        .sort(),
    ).toEqual([
      ['alice', 1000],
      ['bob', 1000],
    ]);
  });

  it('refunds whoever paid when the deposit window closes, and refunds late deposits', () => {
    const one = run(agreed(), [
      { type: 'depositReceived', player: 'alice', paymentId: 'p1', amount: 1000 },
    ]).doc;
    const cancelled = applyCommand(one, { type: 'tick' }, env(T0 + CONFIG.lockTimeoutMs)).doc;
    expect(cancelled.status).toBe('CANCELLED');
    expect(Object.values(cancelled.payouts)).toEqual([
      expect.objectContaining({ player: 'alice', kind: 'refund', amount: 1000 }),
    ]);
    const late = run(cancelled, [
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    expect(late.status).toBe('CANCELLED');
    expect(late.payouts['refund:bob']).toMatchObject({ amount: 1000, status: 'pending' });
  });

  it('refunds an underpayment and keeps waiting', () => {
    const doc = run(agreed(), [
      { type: 'depositReceived', player: 'alice', paymentId: 'p1', amount: 10 },
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    expect(doc.status).toBe('AWAITING_DEPOSITS');
    expect(doc.payouts['refund:alice']).toMatchObject({ amount: 10 });
  });

  it('views show each player only their own invoice', () => {
    const doc = run(agreed(), [
      { type: 'invoicesIssued', invoices: { alice: 'inv-a', bob: 'inv-b' } },
      { type: 'depositReceived', player: 'bob', paymentId: 'p2', amount: 1000 },
    ]).doc;
    const users = new Map([
      ['alice', { nickname: 'A', sparkAddress: 'a' }],
      ['bob', { nickname: 'B', sparkAddress: 'b' }],
    ]);
    const a = viewFor(doc, 'alice', plugin, users);
    expect(a.mode).toBe('escrow');
    expect(a.escrow).toMatchObject({ yourInvoice: 'inv-a', paid: { alice: false, bob: true } });
    expect(JSON.stringify(a)).not.toContain('inv-b');
    expect(viewFor(doc, null, plugin, users).escrow?.yourInvoice).toBeNull();
    expect(viewFor(newDoc(), 'alice', plugin, users).escrow).toBeNull();
  });

  it('property: never owes more than it received, never duplicates an obligation', () => {
    const cmd = fc.oneof(
      fc.record({
        type: fc.constant('depositReceived' as const),
        player: fc.constantFrom('alice', 'bob'),
        paymentId: fc.string({ minLength: 1, maxLength: 4 }),
        amount: fc.constantFrom(1000, 10, 1500),
      }),
      fc.record({
        type: fc.constant('payoutResult' as const),
        key: fc.constantFrom('payout:alice', 'payout:bob', 'refund:alice', 'refund:bob'),
        ok: fc.boolean(),
      }),
      fc.record({ type: fc.constant('resign' as const), player: fc.constantFrom('alice', 'bob') }),
      fc.record({ type: fc.constant('tick' as const), late: fc.boolean() }),
    );
    fc.assert(
      fc.property(fc.array(cmd, { maxLength: 25 }), (cmds) => {
        let doc = agreed();
        for (const c of cmds) {
          const now = c.type === 'tick' && c.late ? T0 + CONFIG.lockTimeoutMs : T0;
          const command = (c.type === 'tick' ? { type: 'tick' } : c) as MatchCommand;
          try {
            doc = applyCommand(doc, command, env(now)).doc;
          } catch {
            /* rejected commands change nothing */
          }
          const inTotal = Object.values(doc.deposits).reduce(
            (sum, d) => sum + (d.paymentId ? doc.stake : 0),
            0,
          );
          const owedTotal = Object.values(doc.payouts).reduce((sum, p) => sum + p.amount, 0);
          const refundsOfOddAmounts = Object.values(doc.payouts)
            .filter((p) => p.kind === 'refund' && p.amount !== doc.stake)
            .reduce((sum, p) => sum + p.amount, 0);
          // Everything owed is covered by deposits received (odd amounts are refunded as-is).
          expect(owedTotal - refundsOfOddAmounts).toBeLessThanOrEqual(inTotal);
          // Keys are unique by construction; each player gets at most one payout and one refund.
          expect(Object.keys(doc.payouts).length).toBeLessThanOrEqual(4);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------

async function setupService(opts: { escrow?: boolean; lockTimeoutMs?: number } = {}) {
  const net = new MockNetwork();
  const escrow = new MockEscrow(net);
  const matches = new MemoryMatchRepo();
  const users = new MemoryUserRepo();
  for (const id of ['alice', 'bob']) {
    net.wallet(id, 10_000);
    await users.upsert({
      _id: id,
      nickname: id,
      sparkAddress: id,
      createdAt: 0,
      lastLoginAt: 0,
      bonusPaidAt: null,
    });
  }
  const make = () =>
    new MatchService({
      matches,
      users,
      plugins: games,
      verifier: mockVerifier,
      config: { ...CONFIG, lockTimeoutMs: opts.lockTimeoutMs ?? CONFIG.lockTimeoutMs },
      escrow: opts.escrow === false ? undefined : escrow,
      depositPollMs: 20,
      payoutRetryMs: 20,
      events: { changed: vi.fn(), codeReleased: vi.fn() },
    });
  return { net, escrow, matches, users, service: make(), make };
}

const until = async <T>(fn: () => Promise<T | null | false | undefined>, ms = 3000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function toDeposits(service: MatchService) {
  const created = await service.create('alice', { gameId: 'tictactoe', stake: 1000 });
  await service.join('bob', created.inviteCode);
  await service.command(created._id, { type: 'accept', player: 'bob' });
  return until(async () => {
    const d = await service.get(created._id);
    return d.deposits.alice?.invoice && d.deposits.bob?.invoice ? d : null;
  });
}

describe('escrow service (mock escrow)', () => {
  it('collects both stakes, pays the winner the whole pot instantly, and settles', async () => {
    const { net, service, escrow } = await setupService();
    try {
      const doc = await toDeposits(service);
      expect(doc.mode).toBe('escrow');
      await net
        .wallet('alice')
        .payInvoice(doc.deposits.alice!.invoice!, `deposit:${doc._id}:alice`);
      await net.wallet('bob').payInvoice(doc.deposits.bob!.invoice!, `deposit:${doc._id}:bob`);
      const playing = await until(async () => {
        const d = await service.get(doc._id);
        return d.status === 'IN_PROGRESS' ? d : null;
      });
      expect(net.balanceOf(escrow.id)).toBe(2000);
      const loser = (playing.session!.state as { players: string[]; turn: number }).players[
        (playing.session!.state as { turn: number }).turn
      ]!;
      const winner = loser === 'alice' ? 'bob' : 'alice';
      await service.command(doc._id, { type: 'resign', player: loser });
      const settled = await until(async () => {
        const d = await service.get(doc._id);
        return d.status === 'SETTLED' ? d : null;
      });
      expect(settled.payoutsOpen).toBe(false);
      expect(net.balanceOf(winner)).toBe(11_000);
      expect(net.balanceOf(loser)).toBe(9_000);
      expect(net.balanceOf(escrow.id)).toBe(0);
    } finally {
      service.stop();
    }
  });

  it('recovers lost deposit events by polling, and ignores duplicate events', async () => {
    const { net, service } = await setupService();
    try {
      const doc = await toDeposits(service);
      net.faults.dropInvoiceEvents = true;
      await net.wallet('alice').payInvoice(doc.deposits.alice!.invoice!, 'a');
      net.faults.dropInvoiceEvents = false;
      net.faults.duplicateInvoiceEvents = true;
      await net.wallet('bob').payInvoice(doc.deposits.bob!.invoice!, 'b');
      const started = await until(async () => {
        const d = await service.get(doc._id);
        return d.status === 'IN_PROGRESS' ? d : null;
      });
      expect(started.transitions.filter((t) => t.to === 'IN_PROGRESS')).toHaveLength(1);
    } finally {
      service.stop();
    }
  });

  it('retries a failed payout with backoff until it succeeds, paying once', async () => {
    const { net, service, escrow } = await setupService();
    try {
      const doc = await toDeposits(service);
      await net.wallet('alice').payInvoice(doc.deposits.alice!.invoice!, 'a');
      await net.wallet('bob').payInvoice(doc.deposits.bob!.invoice!, 'b');
      await until(async () => (await service.get(doc._id)).status === 'IN_PROGRESS');
      net.faults.failPayouts = true;
      await service.command(doc._id, { type: 'resign', player: 'alice' });
      await until(async () => (await service.get(doc._id)).payouts['payout:bob']?.attempts);
      net.faults.failPayouts = false;
      // The failed attempt recorded a failed key; clear it the way a real retry would see it.
      const settled = await until(async () => {
        const d = await service.get(doc._id);
        return d.status === 'SETTLED' ? d : null;
      });
      expect(settled.payouts['payout:bob']!.attempts).toBeGreaterThanOrEqual(1);
      expect(net.balanceOf('bob')).toBe(11_000);
      expect(net.balanceOf(escrow.id)).toBe(0);
    } finally {
      service.stop();
    }
  });

  it('after a crash between paying and recording, reconcile marks it paid without paying again', async () => {
    const { net, escrow, service, make } = await setupService();
    const doc = await toDeposits(service);
    await net.wallet('alice').payInvoice(doc.deposits.alice!.invoice!, 'a');
    await net.wallet('bob').payInvoice(doc.deposits.bob!.invoice!, 'b');
    await until(async () => (await service.get(doc._id)).status === 'IN_PROGRESS');
    // Crash: the escrow is paused (payouts fail) as the result lands…
    net.faults.failPayouts = true;
    await service.command(doc._id, { type: 'resign', player: 'alice' });
    await until(async () => (await service.get(doc._id)).payouts['payout:bob']?.attempts);
    service.stop();
    net.faults.failPayouts = false;
    // …but the money actually went out before the process died.
    await escrow.pay('bob', 2000, `payout:${doc._id}:bob`);
    expect(net.balanceOf('bob')).toBe(11_000);

    const restarted = make();
    try {
      await restarted.reconcile();
      const settled = await until(async () => {
        const d = await restarted.get(doc._id);
        return d.status === 'SETTLED' ? d : null;
      });
      expect(settled.payouts['payout:bob']!.status).toBe('paid');
      expect(net.balanceOf('bob')).toBe(11_000); // not paid twice
      expect(net.balanceOf(escrow.id)).toBe(0);
    } finally {
      restarted.stop();
    }
  });

  it('cancels and refunds when only one player pays in time', async () => {
    const { net, service, escrow } = await setupService({ lockTimeoutMs: 2000 });
    try {
      const doc = await toDeposits(service);
      await net.wallet('alice').payInvoice(doc.deposits.alice!.invoice!, 'a');
      const done = await until(async () => {
        const d = await service.get(doc._id);
        return d.status === 'CANCELLED' && !d.payoutsOpen ? d : null;
      }, 10_000);
      expect(done.payouts['refund:alice']!.status).toBe('paid');
      expect(net.balanceOf('alice')).toBe(10_000);
      expect(net.balanceOf(escrow.id)).toBe(0);
    } finally {
      service.stop();
    }
  });

  it('checkDeposits picks up a payment immediately on the client hint', async () => {
    const { net, service } = await setupService();
    try {
      const doc = await toDeposits(service);
      net.faults.dropInvoiceEvents = true;
      await net.wallet('alice').payInvoice(doc.deposits.alice!.invoice!, 'a');
      const checked = await service.checkDeposits(doc._id);
      expect(checked.deposits.alice!.paymentId).not.toBeNull();
    } finally {
      service.stop();
    }
  });

  it('refuses to create escrow matches without an escrow wallet', async () => {
    const { service } = await setupService({ escrow: false });
    await expect(service.create('alice', { gameId: 'tictactoe', stake: 1000 })).rejects.toThrow(
      /unavailable/,
    );
    service.stop();
  });
});
