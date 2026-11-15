import { describe, expect, it, vi } from 'vitest';
import { idempotencyUuid, paymentHashOf, signedMessages } from '../src/index.js';
import { MockNetwork, mockSignature, mockVerifier } from '../src/mock.js';

const PRE_A = 'aa'.repeat(32);
const PRE_B = 'bb'.repeat(32);

function setup() {
  let t = 1_000_000;
  const net = new MockNetwork(() => t);
  const alice = net.wallet('alice', 10_000);
  const bob = net.wallet('bob', 10_000);
  return { net, alice, bob, advance: (s: number) => (t += s) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('payment hashes and messages', () => {
  it('hashes hex preimages with sha256', () => {
    expect(paymentHashOf('00'.repeat(32))).toBe(
      '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
    );
  });

  it('builds domain-separated messages', () => {
    expect(signedMessages.login('n1')).toBe('coinclash:v1:login:n1');
    expect(signedMessages.lockSeen('m', 'h', 5)).toBe('coinclash:v1:lock-seen:m:h:5');
    expect(signedMessages.claimed('m', 'h')).toBe('coinclash:v1:claimed:m:h');
  });
});

describe('idempotencyUuid', () => {
  it('is a stable, valid v4-layout UUID per key', () => {
    const a = idempotencyUuid('bonus:alice');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotencyUuid('bonus:alice')).toBe(a);
    expect(idempotencyUuid('bonus:bob')).not.toBe(a);
  });
});

describe('mock signatures', () => {
  it('verify only for the right key and message', async () => {
    const { alice } = setup();
    const signed = await alice.signMessage('hello');
    expect(await mockVerifier.verify(signed)).toBe(true);
    expect(await mockVerifier.verify({ ...signed, message: 'other' })).toBe(false);
    expect(await mockVerifier.verify({ ...signed, pubkey: 'bob' })).toBe(false);
    expect(signed.signature).toBe(mockSignature('alice', 'hello'));
  });
});

describe('mock HTLCs', () => {
  it('locks, notifies, and lets the receiver claim with the preimage', async () => {
    const { net, alice, bob } = setup();
    const seen = vi.fn();
    bob.onIncomingLock(seen);
    const hash = paymentHashOf(PRE_B);
    await alice.lock({ to: 'bob', amount: 3000, paymentHash: hash, expirySecs: 600 });
    expect(await alice.getBalance()).toBe(7000);
    await flush();
    expect(seen).toHaveBeenCalledOnce();
    expect(await bob.findIncomingLock(hash)).toMatchObject({
      from: 'alice',
      amount: 3000,
      status: 'waiting',
    });
    await expect(bob.claim(PRE_A)).rejects.toThrow(/No claimable/);
    expect(await bob.claim(PRE_B)).toMatchObject({ amount: 3000 });
    expect(await bob.getBalance()).toBe(13_000);
    await expect(bob.claim(PRE_B)).rejects.toThrow(/No claimable/);
    expect(net.allLocks()[0]?.status).toBe('claimed');
  });

  it('returns unclaimed locks to the sender at expiry', async () => {
    const { alice, bob, advance } = setup();
    const hash = paymentHashOf(PRE_B);
    await alice.lock({ to: 'bob', amount: 3000, paymentHash: hash, expirySecs: 600 });
    advance(599);
    expect(await alice.getBalance()).toBe(7000);
    advance(1);
    expect(await alice.getBalance()).toBe(10_000);
    expect((await bob.findIncomingLock(hash))?.status).toBe('returned');
    await expect(bob.claim(PRE_B)).rejects.toThrow();
  });

  it('validates lock requests and balances', async () => {
    const { alice } = setup();
    const ok = { to: 'bob', amount: 100, paymentHash: paymentHashOf(PRE_B), expirySecs: 60 };
    await expect(alice.lock({ ...ok, amount: 0 })).rejects.toThrow(/amount/);
    await expect(alice.lock({ ...ok, paymentHash: 'xyz' })).rejects.toThrow(/hash/);
    await expect(alice.lock({ ...ok, expirySecs: 0 })).rejects.toThrow(/expiry/);
    await expect(alice.lock({ ...ok, amount: 50_000 })).rejects.toThrow(/Insufficient/);
    await alice.lock(ok);
    await expect(alice.lock(ok)).rejects.toThrow(/Duplicate/);
  });

  it('injects faults: dropped locks, duplicate events, failing claims, fees, delays', async () => {
    const { net, alice, bob } = setup();
    const seen = vi.fn();
    const unsubscribe = bob.onIncomingLock(seen);
    net.faults.dropLocks = true;
    await alice.lock({ to: 'bob', amount: 100, paymentHash: paymentHashOf(PRE_A), expirySecs: 60 });
    expect(await bob.findIncomingLock(paymentHashOf(PRE_A))).toBeNull();
    net.faults.dropLocks = false;

    net.faults.duplicateLockEvents = true;
    net.faults.lockFee = 7;
    expect(await alice.estimateLockFee('bob', 100)).toBe(7);
    await alice.lock({ to: 'bob', amount: 100, paymentHash: paymentHashOf(PRE_B), expirySecs: 60 });
    await flush();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(await alice.getBalance()).toBe(10_000 - 100 - 107);

    net.faults.failClaims = true;
    await expect(bob.claim(PRE_B)).rejects.toThrow(/injected/);
    net.faults.failClaims = false;
    await expect(bob.claim('zz')).rejects.toThrow(/Invalid preimage/);

    unsubscribe();
    net.faults.duplicateLockEvents = false;
    net.faults.lockEventDelayMs = 5;
    const late = vi.fn();
    bob.onIncomingLock(late);
    await alice.lock({
      to: 'bob',
      amount: 1,
      paymentHash: paymentHashOf('cc'.repeat(32)),
      expirySecs: 60,
    });
    await flush();
    expect(late).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(late).toHaveBeenCalledOnce();
  });

  it('exposes identity, address and faucet', async () => {
    const { net, alice } = setup();
    expect(await alice.identity()).toBe('alice');
    expect(await alice.sparkAddress()).toBe('alice');
    net.fund('alice', 5);
    expect(net.balanceOf('alice')).toBe(10_005);
    expect(net.wallet('alice', 999).id).toBe('alice');
    expect(net.balanceOf('alice')).toBe(10_005);
    expect(net.balanceOf('nobody')).toBe(0);
  });
});

describe('mock escrow (invoices, keyed payouts)', () => {
  it('takes exactly one payment per invoice, from the bound payer only, and pays out once per key', async () => {
    let t = 1_000_000;
    const net = new MockNetwork(() => t);
    const { MockEscrow } = await import('../src/mock.js');
    const escrow = new MockEscrow(net);
    const alice = net.wallet('alice', 5_000);
    net.wallet('bob', 5_000);
    const events: string[] = [];
    escrow.onInvoicePaid((p) => events.push(p.invoice));

    const inv = await escrow.createInvoice({
      amount: 1000,
      expiresAt: t + 60,
      payerIdentity: 'alice',
      memo: 'm',
    });
    await expect(net.wallet('bob').payInvoice(inv, 'k')).rejects.toThrow(/another payer/);
    const first = await alice.payInvoice(inv, 'deposit:m1');
    expect(await alice.payInvoice(inv, 'deposit:m1')).toEqual(first); // idempotent
    await expect(alice.payInvoice(inv, 'other-key')).rejects.toThrow(/already paid/);
    await flush();
    expect(events).toEqual([inv]);
    expect(await escrow.findInvoicePayment(inv)).toMatchObject({ amount: 1000 });
    expect(net.balanceOf('alice')).toBe(4000);

    const out = await escrow.pay('bob', 1000, 'payout:m1:bob');
    expect(await escrow.pay('bob', 1000, 'payout:m1:bob')).toEqual(out);
    expect(net.balanceOf('bob')).toBe(6000);
    expect(await escrow.paymentStatus('payout:m1:bob')).toBe('completed');
    expect(await escrow.paymentStatus('payout:m1:nobody')).toBeNull();

    net.faults.failPayouts = true;
    await expect(escrow.pay('bob', 1, 'payout:x')).rejects.toThrow(/injected/);
    expect(await escrow.paymentStatus('payout:x')).toBe('failed');
    net.faults.failPayouts = false;

    const late = await escrow.createInvoice({
      amount: 10,
      expiresAt: t + 1,
      payerIdentity: 'alice',
      memo: 'm',
    });
    t += 5;
    await expect(alice.payInvoice(late, 'late')).rejects.toThrow(/expired/);
    await expect(alice.payInvoice('nope', 'n')).rejects.toThrow(/Unknown invoice/);
  });

  it('treats idempotency keys as network-wide transfer ids, like Spark', async () => {
    const net = new MockNetwork(() => 0);
    const { MockEscrow } = await import('../src/mock.js');
    const escrow = new MockEscrow(net);
    net.wallet('alice', 100);
    net.wallet('bob', 100);
    const ia = await escrow.createInvoice({
      amount: 1,
      expiresAt: 10,
      payerIdentity: 'alice',
      memo: '',
    });
    const ib = await escrow.createInvoice({
      amount: 1,
      expiresAt: 10,
      payerIdentity: 'bob',
      memo: '',
    });
    await net.wallet('alice').payInvoice(ia, 'deposit:m1');
    await expect(net.wallet('bob').payInvoice(ib, 'deposit:m1')).rejects.toThrow(/already exists/);
  });

  it('can drop or duplicate invoice events', async () => {
    const net = new MockNetwork(() => 0);
    const { MockEscrow } = await import('../src/mock.js');
    const escrow = new MockEscrow(net);
    const alice = net.wallet('alice', 100);
    const seen: string[] = [];
    escrow.onInvoicePaid((p) => seen.push(p.paymentId));
    net.faults.duplicateInvoiceEvents = true;
    await alice.payInvoice(
      await escrow.createInvoice({ amount: 1, expiresAt: 10, payerIdentity: 'alice', memo: '' }),
      'a',
    );
    net.faults.duplicateInvoiceEvents = false;
    net.faults.dropInvoiceEvents = true;
    await alice.payInvoice(
      await escrow.createInvoice({ amount: 1, expiresAt: 10, payerIdentity: 'alice', memo: '' }),
      'b',
    );
    await flush();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
