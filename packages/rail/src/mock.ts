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
  type IncomingLock,
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
  };
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
}
