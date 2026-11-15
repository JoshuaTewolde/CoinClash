import { paymentHashOf, signedMessages } from '@coinclash/rail';
import { MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import type { MatchView } from '@coinclash/shared';
import { describe, expect, it, vi } from 'vitest';
import { MatchAgent } from '../src/match/agent';

const T = 2_000_000_000; // Unix seconds
const P_ALICE = 'aa'.repeat(32); // "alice wins"
const P_BOB = 'bb'.repeat(32);

function view(you: 'alice' | 'bob', over: Partial<MatchView> = {}): MatchView {
  const opp = you === 'alice' ? 'bob' : 'alice';
  const hashes = { alice: paymentHashOf(P_ALICE), bob: paymentHashOf(P_BOB) };
  return {
    id: 'm1',
    inviteCode: 'inv',
    gameId: 'tictactoe',
    status: 'AWAITING_LOCKS',
    stake: 1000,
    proposals: [],
    challenger: { id: 'alice', nickname: 'Alice' },
    opponent: { id: 'bob', nickname: 'Bob' },
    you,
    respondent: null,
    mode: 'htlc',
    escrow: null,
    locks: {
      lockToHash: hashes[opp],
      incomingHash: hashes[you],
      opponentSparkAddress: opp,
      htlcExpiresAt: T + 1800,
      lockDeadline: (T + 180) * 1000,
      locked: { alice: false, bob: false },
    },
    game: null,
    claimDeadline: null,
    claimedBy: [],
    opponentGraceEndsAt: null,
    rematchOf: null,
    rematchId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function setup() {
  const net = new MockNetwork(() => T);
  const sent: { event: string; payload: Record<string, unknown> }[] = [];
  const memory = new Map<string, string>();
  const make = (id: 'alice' | 'bob') =>
    new MatchAgent({
      wallet: net.wallet(id, 5000),
      send: async (event, payload) => {
        sent.push({ event, payload: payload as Record<string, unknown> });
      },
      nowSec: () => T,
      memory: {
        getItem: (k) => memory.get(`${id}:${k}`) ?? null,
        setItem: (k, v) => memory.set(`${id}:${k}`, v),
      },
    });
  return { net, sent, alice: make('alice'), bob: make('bob') };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('MatchAgent', () => {
  it('locks once, then confirms the opponent lock with a valid signed attestation', async () => {
    const { net, sent, alice, bob } = setup();
    await alice.lock(view('alice'));
    await alice.lock(view('alice')); // idempotent
    expect(alice.hasLocked('m1')).toBe(true);
    expect(net.balanceOf('alice')).toBe(4000);

    // Alice's lock is for Bob. Bob hasn't seen anything for himself yet? He has: alice locked to him.
    expect(await alice.sync(view('alice'))).toBe(true); // bob hasn't locked to alice yet
    await tick();
    expect(await bob.sync(view('bob'))).toBe(false);
    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    expect(msg.event).toBe('match:lockSeen');
    const signed = msg.payload.signed as { message: string; pubkey: string; signature: string };
    expect(signed.message).toBe(signedMessages.lockSeen('m1', paymentHashOf(P_BOB), 1000));
    expect(await mockVerifier.verify(signed)).toBe(true);

    // No duplicate confirmation.
    expect(await bob.sync(view('bob'))).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('ignores a lock that is too small or expires too early', async () => {
    const { net, sent, bob } = setup();
    net
      .wallet('alice')
      .lock({ to: 'bob', amount: 999, paymentHash: paymentHashOf(P_BOB), expirySecs: 1800 });
    await tick();
    expect(await bob.sync(view('bob'))).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('skips work when not awaiting locks or already confirmed', async () => {
    const { sent, bob } = setup();
    expect(await bob.sync(view('bob', { status: 'IN_PROGRESS' }))).toBe(false);
    const v = view('bob');
    expect(
      await bob.sync({ ...v, locks: { ...v.locks!, locked: { alice: true, bob: false } } }),
    ).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('refuses to lock too close to expiry or outside the lock stage', async () => {
    const { alice } = setup();
    const v = view('alice');
    await expect(
      alice.lock({ ...v, locks: { ...v.locks!, htlcExpiresAt: T + 30 } }),
    ).rejects.toThrow(/Too late/);
    await expect(alice.lock(view('alice', { status: 'NEGOTIATING' }))).rejects.toThrow(
      /Nothing to lock/,
    );
  });

  it('claims with a released code and reports it; a repeat or reload still confirms', async () => {
    const { net, sent, alice, bob } = setup();
    await alice.lock(view('alice'));
    await bob.lock(view('bob'));
    await tick();
    const release = { matchId: 'm1', preimage: P_ALICE, paymentHash: paymentHashOf(P_ALICE) };
    await alice.onCode(release);
    await alice.onCode(release); // deduped
    expect(net.balanceOf('alice')).toBe(5000); // 4000 + bob's 1000
    expect(sent.filter((s) => s.event === 'match:claimed')).toHaveLength(1);

    // A fresh agent (page reload) gets the code again: claim fails, but the lock is claimed.
    const reloaded = new MatchAgent({
      wallet: net.wallet('alice'),
      send: async (event, payload) => {
        sent.push({ event, payload: payload as Record<string, unknown> });
      },
    });
    await reloaded.onCode(release);
    expect(sent.filter((s) => s.event === 'match:claimed')).toHaveLength(2);
  });

  it('reports claim errors without confirming', async () => {
    const { net, sent } = setup();
    const onError = vi.fn();
    const agent = new MatchAgent({
      wallet: net.wallet('alice'),
      send: async (event, payload) => {
        sent.push({ event, payload: payload as Record<string, unknown> });
      },
      onError,
    });
    await agent.onCode({ matchId: 'm1', preimage: P_ALICE, paymentHash: paymentHashOf(P_ALICE) });
    expect(onError).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('pays the escrow deposit once with a stable key and nudges the server', async () => {
    const { MockEscrow } = await import('@coinclash/rail/mock');
    const net = new MockNetwork(() => T);
    const escrow = new MockEscrow(net);
    const wallet = net.wallet('alice', 5000);
    const sent: string[] = [];
    const agent = new MatchAgent({
      wallet,
      send: async (event) => {
        sent.push(event);
      },
      nowSec: () => T,
    });
    const invoice = await escrow.createInvoice({
      amount: 1000,
      expiresAt: T + 600,
      payerIdentity: 'alice',
      memo: 'm',
    });
    const v = view('alice', {
      status: 'AWAITING_DEPOSITS',
      mode: 'escrow',
      locks: null,
      escrow: {
        deadline: (T + 180) * 1000,
        paid: { alice: false, bob: false },
        yourInvoice: invoice,
        payouts: [],
      },
    });
    await agent.payDeposit(v);
    await agent.payDeposit(v); // idempotent: same key, paid once
    expect(net.balanceOf('alice')).toBe(4000);
    expect(net.balanceOf(escrow.id)).toBe(1000);
    expect(sent).toContain('match:paid');
    await agent.payDeposit({ ...v, escrow: { ...v.escrow!, paid: { alice: true, bob: false } } });
    await expect(agent.payDeposit({ ...v, status: 'IN_PROGRESS' })).rejects.toThrow(
      /Nothing to pay/,
    );
    await expect(
      agent.payDeposit({ ...v, escrow: { ...v.escrow!, yourInvoice: null } }),
    ).rejects.toThrow(/ready/);
  });
});
