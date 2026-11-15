/**
 * In-memory mock of the Spark network for tests, CI and offline UI dev (NETWORK=mock).
 * **Never exposed to players.** Signatures are fake. Time comes from an injectable clock.
 *
 * Fault injection (`network.faults`) lets tests force the edge cases from ADR 0002:
 * locks that never arrive, duplicate lock events, failing claims, slow confirmations.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  paymentHashOf,
  type EscrowRail,
  type IncomingLock,
  type InvoicePayment,
  type LockRequest,
  type Sats,
  type SignatureVerifier,
  type SignedMessage,
  type WalletRail,
} from './index.js';

export interface MockFaults {
  /** Locks are debited from the sender but never reach the receiver. */
  dropLocks: boolean;
  /** Every incoming-lock event is delivered twice. */
  duplicateLockEvents: boolean;
  /** `claim` rejects with an error. */
  failClaims: boolean;
  /** Extra delay (ms) before lock events fire. */
  lockEventDelayMs: number;
  /** Flat fee charged per lock. */
  lockFee: Sats;
  /** Escrow payouts (`send`) reject with an error. */
  failPayouts: boolean;
  /** Invoice-paid events are never delivered (polling must recover them). */
  dropInvoiceEvents: boolean;
  /** Invoice-paid events are delivered twice. */
  duplicateInvoiceEvents: boolean;
}

interface Invoice {
  to: string;
  amount: Sats;
  expiresAt: number;
  payer: string;
  paid: { paymentId: string; from: string } | null;
}

interface Htlc {
  paymentId: string;
  from: string;
  to: string;
  amount: Sats;
  paymentHash: string;
  expiresAt: number;
  status: 'waiting' | 'claimed' | 'returned';
}

export function mockSignature(pubkey: string, message: string): string {
  return `mocksig:${bytesToHex(sha256(utf8ToBytes(`${pubkey}\n${message}`)))}`;
}

/** Verifies `mockSignature` signatures. Mock mode only. */
export const mockVerifier: SignatureVerifier = {
  verify: async ({ message, pubkey, signature }) => signature === mockSignature(pubkey, message),
};

export class MockNetwork {
  readonly faults: MockFaults = {
    dropLocks: false,
    duplicateLockEvents: false,
    failClaims: false,
    lockEventDelayMs: 0,
    lockFee: 0,
    failPayouts: false,
    dropInvoiceEvents: false,
    duplicateInvoiceEvents: false,
  };
  private readonly invoices = new Map<string, Invoice>();
  private readonly keyed = new Map<string, { paymentId: string; status: 'completed' | 'failed' }>();
  /** Like Spark: an idempotency key is a transfer id, unique across the whole network. */
  private readonly keyOwner = new Map<string, string>();
  private claimKey(from: string, key: string): void {
    const owner = this.keyOwner.get(key);
    if (owner !== undefined && owner !== from) throw new Error(`transfer ${key} already exists`);
    this.keyOwner.set(key, from);
  }
  private readonly invoiceListeners = new Map<string, Set<(p: InvoicePayment) => void>>();
  private readonly balances = new Map<string, Sats>();
  private readonly htlcs: Htlc[] = [];
  private readonly listeners = new Map<string, Set<(lock: IncomingLock) => void>>();
  private seq = 0;

  /** @param now Clock in Unix **seconds** (inject a fake clock in tests). */
  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** Create (or reconnect to) a wallet. `id` doubles as its identity pubkey and Spark address. */
  wallet(id: string, initialBalance: Sats = 0): MockWallet {
    if (!this.balances.has(id)) this.balances.set(id, initialBalance);
    return new MockWallet(this, id);
  }

  /** Testing faucet. */
  fund(id: string, amount: Sats): void {
    this.balances.set(id, this.balanceOf(id) + amount);
  }

  balanceOf(id: string): Sats {
    this.expire();
    return this.balances.get(id) ?? 0;
  }

  /** All HTLCs, for assertions. */
  allLocks(): readonly Readonly<Htlc>[] {
    this.expire();
    return this.htlcs.map((h) => ({ ...h }));
  }

  /** Return expired, unclaimed HTLCs to their senders. Called lazily on every read. */
  expire(): void {
    const t = this.now();
    for (const h of this.htlcs) {
      if (h.status === 'waiting' && t >= h.expiresAt) {
        h.status = 'returned';
        this.balances.set(h.from, (this.balances.get(h.from) ?? 0) + h.amount);
      }
    }
  }

  /** @internal */
  lock(from: string, req: LockRequest): { paymentId: string } {
    if (!Number.isInteger(req.amount) || req.amount <= 0) throw new Error('Invalid amount');
    if (!/^[0-9a-f]{64}$/.test(req.paymentHash)) throw new Error('Invalid payment hash');
    if (req.expirySecs <= 0) throw new Error('Invalid expiry');
    if (this.htlcs.some((h) => h.paymentHash === req.paymentHash && h.from === from)) {
      throw new Error('Duplicate HTLC for this payment hash');
    }
    const total = req.amount + this.faults.lockFee;
    if (this.balanceOf(from) < total) throw new Error('Insufficient funds');
    this.balances.set(from, this.balanceOf(from) - total);
    const paymentId = `mockpay-${++this.seq}`;
    if (this.faults.dropLocks) return { paymentId };
    const htlc: Htlc = {
      paymentId,
      from,
      to: req.to,
      amount: req.amount,
      paymentHash: req.paymentHash,
      expiresAt: this.now() + req.expirySecs,
      status: 'waiting',
    };
    this.htlcs.push(htlc);
    const deliver = () => {
      const view = toIncoming(htlc);
      const times = this.faults.duplicateLockEvents ? 2 : 1;
      for (let i = 0; i < times; i++) for (const l of this.listeners.get(req.to) ?? []) l(view);
    };
    if (this.faults.lockEventDelayMs > 0) setTimeout(deliver, this.faults.lockEventDelayMs);
    else queueMicrotask(deliver);
    return { paymentId };
  }

  /** @internal */
  findIncoming(to: string, paymentHash: string): IncomingLock | null {
    this.expire();
    const h = this.htlcs.find((x) => x.to === to && x.paymentHash === paymentHash);
    return h ? toIncoming(h) : null;
  }

  /** @internal */
  subscribe(to: string, listener: (lock: IncomingLock) => void): () => void {
    const set = this.listeners.get(to) ?? new Set();
    set.add(listener);
    this.listeners.set(to, set);
    return () => set.delete(listener);
  }

  /** @internal */
  createInvoice(to: string, amount: Sats, expiresAt: number, payer: string): string {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid amount');
    const invoice = `mockinv-${++this.seq}-${to}`;
    this.invoices.set(invoice, { to, amount, expiresAt, payer, paid: null });
    return invoice;
  }

  /** @internal Pay an invoice. Idempotent per (payer, key). */
  payInvoice(from: string, invoice: string, key: string): { paymentId: string } {
    this.claimKey(from, key);
    const k = `${from}
${key}`;
    const done = this.keyed.get(k);
    if (done?.status === 'completed') return { paymentId: done.paymentId };
    const inv = this.invoices.get(invoice);
    if (!inv) throw new Error('Unknown invoice');
    if (inv.paid) throw new Error('Invoice already paid');
    if (this.now() >= inv.expiresAt) throw new Error('Invoice expired');
    if (inv.payer !== from) throw new Error('This invoice is for another payer');
    if (this.balanceOf(from) < inv.amount) throw new Error('Insufficient funds');
    this.balances.set(from, this.balanceOf(from) - inv.amount);
    this.balances.set(inv.to, this.balanceOf(inv.to) + inv.amount);
    const paymentId = `mockpay-${++this.seq}`;
    inv.paid = { paymentId, from };
    this.keyed.set(k, { paymentId, status: 'completed' });
    if (!this.faults.dropInvoiceEvents) {
      const event: InvoicePayment = { invoice, paymentId, amount: inv.amount };
      const times = this.faults.duplicateInvoiceEvents ? 2 : 1;
      queueMicrotask(() => {
        for (let i = 0; i < times; i++)
          for (const l of this.invoiceListeners.get(inv.to) ?? []) l(event);
      });
    }
    return { paymentId };
  }

  /** @internal */
  findInvoicePayment(to: string, invoice: string): InvoicePayment | null {
    const inv = this.invoices.get(invoice);
    if (!inv || inv.to !== to || !inv.paid) return null;
    return { invoice, paymentId: inv.paid.paymentId, amount: inv.amount };
  }

  /** @internal */
  subscribeInvoices(to: string, listener: (p: InvoicePayment) => void): () => void {
    const set = this.invoiceListeners.get(to) ?? new Set();
    set.add(listener);
    this.invoiceListeners.set(to, set);
    return () => set.delete(listener);
  }

  /** @internal Plain transfer, idempotent per (sender, key). */
  send(from: string, to: string, amount: Sats, key: string): { paymentId: string } {
    this.claimKey(from, key);
    const k = `${from}
${key}`;
    const done = this.keyed.get(k);
    if (done?.status === 'completed') return { paymentId: done.paymentId };
    if (this.faults.failPayouts) {
      this.keyed.set(k, { paymentId: `mockfail-${++this.seq}`, status: 'failed' });
      throw new Error('Payout failed (injected fault)');
    }
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid amount');
    if (this.balanceOf(from) < amount) throw new Error('Insufficient funds');
    this.balances.set(from, this.balanceOf(from) - amount);
    this.balances.set(to, this.balanceOf(to) + amount);
    const paymentId = `mockpay-${++this.seq}`;
    this.keyed.set(k, { paymentId, status: 'completed' });
    return { paymentId };
  }

  /** @internal */
  keyedStatus(from: string, key: string): 'completed' | 'failed' | null {
    return (
      this.keyed.get(`${from}
${key}`)?.status ?? null
    );
  }

  /** @internal */
  claim(to: string, preimage: string): { paymentId: string; amount: Sats } {
    if (this.faults.failClaims) throw new Error('Claim failed (injected fault)');
    this.expire();
    let hash: string;
    try {
      hash = paymentHashOf(preimage);
    } catch {
      throw new Error('Invalid preimage');
    }
    const h = this.htlcs.find(
      (x) => x.to === to && x.paymentHash === hash && x.status === 'waiting',
    );
    if (!h) throw new Error('No claimable HTLC for this preimage');
    h.status = 'claimed';
    this.balances.set(to, this.balanceOf(to) + h.amount);
    return { paymentId: h.paymentId, amount: h.amount };
  }
}

function toIncoming(h: Htlc): IncomingLock {
  return {
    paymentId: h.paymentId,
    from: h.from,
    amount: h.amount,
    paymentHash: h.paymentHash,
    expiresAt: h.expiresAt,
    status: h.status,
  };
}

export class MockWallet implements WalletRail {
  constructor(
    private readonly network: MockNetwork,
    readonly id: string,
  ) {}

  identity = async () => this.id;
  sparkAddress = async () => this.id;
  getBalance = async () => this.network.balanceOf(this.id);
  estimateLockFee = async (_to: string, _amount: Sats) => this.network.faults.lockFee;
  signMessage = async (message: string): Promise<SignedMessage> => ({
    message,
    pubkey: this.id,
    signature: mockSignature(this.id, message),
  });
  lock = async (req: LockRequest) => this.network.lock(this.id, req);
  findIncomingLock = async (paymentHash: string) => this.network.findIncoming(this.id, paymentHash);
  onIncomingLock = (listener: (lock: IncomingLock) => void) =>
    this.network.subscribe(this.id, listener);
  claim = async (preimage: string) => this.network.claim(this.id, preimage);
  payInvoice = async (invoice: string, idempotencyKey: string) =>
    this.network.payInvoice(this.id, invoice, idempotencyKey);
}

/** Escrow wallet on the mock network (NETWORK=mock, tests). */
export class MockEscrow implements EscrowRail {
  constructor(
    private readonly network: MockNetwork,
    readonly id = 'mock-escrow00',
  ) {
    network.wallet(id, 0);
  }

  createInvoice = async (req: {
    amount: Sats;
    expiresAt: number;
    payerIdentity: string;
    memo: string;
  }) => this.network.createInvoice(this.id, req.amount, req.expiresAt, req.payerIdentity);
  findInvoicePayment = async (invoice: string) => this.network.findInvoicePayment(this.id, invoice);
  onInvoicePaid = (listener: (p: InvoicePayment) => void) =>
    this.network.subscribeInvoices(this.id, listener);
  pay = async (to: string, amount: Sats, idempotencyKey: string) =>
    this.network.send(this.id, to, amount, idempotencyKey);
  paymentStatus = async (idempotencyKey: string) =>
    this.network.keyedStatus(this.id, idempotencyKey);
  balance = async () => this.network.balanceOf(this.id);
}
