/**
 * Payment rail: the only interface through which CoinClash code moves money (ADR 0002).
 *
 * With HTLC "oracle" escrow, money moves **between players' own wallets**. The server only
 * generates the secret codes and releases them. So the rail is a *wallet* interface used by
 * clients (and by simulated clients in tests), plus a `SignatureVerifier` used by the server.
 *
 * Implementations:
 * - `./mock`: in-memory network for tests, CI and offline UI dev (NETWORK=mock). It can inject
 *   faults on demand.
 * - Breez Spark (regtest/mainnet): `apps/web/src/wallet` in Phase 5.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export type Sats = number;

export interface IncomingLock {
  /** Wallet payment id of the pending HTLC. */
  readonly paymentId: string;
  /** Sender's wallet identity. */
  readonly from: string;
  readonly amount: Sats;
  /** SHA-256 of the preimage (hex). */
  readonly paymentHash: string;
  /** Unix seconds after which the funds return to the sender. */
  readonly expiresAt: number;
  readonly status: 'waiting' | 'claimed' | 'returned';
}

export interface LockRequest {
  /** Receiver's Spark address. */
  readonly to: string;
  readonly amount: Sats;
  readonly paymentHash: string;
  /** Seconds from now until the HTLC expires. */
  readonly expirySecs: number;
}

export interface SignedMessage {
  readonly message: string;
  readonly pubkey: string;
  readonly signature: string;
}

export interface WalletRail {
  /** Wallet identity pubkey: the player's app identity. */
  identity(): Promise<string>;
  /** Address other wallets send HTLC locks to. */
  sparkAddress(): Promise<string>;
  getBalance(): Promise<Sats>;
  /** Fee the wallet would pay to lock `amount` to `to`. */
  estimateLockFee(to: string, amount: Sats): Promise<Sats>;
  signMessage(message: string): Promise<SignedMessage>;
  /** Send a hash-locked payment. Resolves with the wallet payment id. */
  lock(req: LockRequest): Promise<{ paymentId: string }>;
  /** Look up an incoming HTLC by payment hash (polling backup for events). */
  findIncomingLock(paymentHash: string): Promise<IncomingLock | null>;
  /** Subscribe to incoming HTLCs. Returns an unsubscribe function. */
  onIncomingLock(listener: (lock: IncomingLock) => void): () => void;
  /** Claim an incoming HTLC by revealing its preimage. */
  claim(preimage: string): Promise<{ paymentId: string; amount: Sats }>;
  /**
   * Pay an escrow deposit invoice (ADR 0013). `idempotencyKey` is a logical key such as
   * `deposit:<matchId>`; paying twice with the same key sends once.
   */
  payInvoice(invoice: string, idempotencyKey: string): Promise<{ paymentId: string }>;
}

/** A payment the escrow wallet received against one of its invoices. */
export interface InvoicePayment {
  readonly invoice: string;
  readonly paymentId: string;
  readonly amount: Sats;
}

/**
 * The server's escrow wallet (ADR 0013: custodial escrow is the active mode). It issues one
 * single-use invoice per player per match, detects deposits, and pays winners and refunds.
 */
export interface EscrowRail {
  /** Invoice for exactly `amount`, payable only by `payerIdentity`, expiring at `expiresAt` (Unix s). */
  createInvoice(req: {
    amount: Sats;
    expiresAt: number;
    payerIdentity: string;
    memo: string;
  }): Promise<string>;
  /** Polling backup for events: the payment received for `invoice`, if any. */
  findInvoicePayment(invoice: string): Promise<InvoicePayment | null>;
  /** Subscribe to received invoice payments. Returns an unsubscribe function. */
  onInvoicePaid(listener: (p: InvoicePayment) => void): () => void;
  /**
   * Pay `amount` to a Spark address. The same `idempotencyKey` never pays twice, even across
   * restarts. Resolves with the payment id; rejects if the payment failed.
   */
  pay(to: string, amount: Sats, idempotencyKey: string): Promise<{ paymentId: string }>;
  /** Sats the escrow wallet holds right now (public escrow page, ADR 0018). */
  balance(): Promise<Sats>;
  /** Did the payment with this logical key already go out? (reconcile after a crash) */
  paymentStatus(idempotencyKey: string): Promise<'completed' | 'pending' | 'failed' | null>;
}

export interface SignatureVerifier {
  verify(signed: SignedMessage): Promise<boolean>;
}

/** SHA-256 payment hash (hex) of a hex preimage, as Spark HTLCs expect. */
export function paymentHashOf(preimageHex: string): string {
  return bytesToHex(sha256(hexToBytes(preimageHex)));
}

/** Messages players sign. Versioned and domain-separated so a signature can't be replayed elsewhere. */
export const signedMessages = {
  login: (nonce: string) => `coinclash:v1:login:${nonce}`,
  lockSeen: (matchId: string, paymentHash: string, amount: Sats) =>
    `coinclash:v1:lock-seen:${matchId}:${paymentHash}:${amount}`,
  claimed: (matchId: string, paymentHash: string) =>
    `coinclash:v1:claimed:${matchId}:${paymentHash}`,
};

/**
 * Deterministic UUID (v4 layout) for a logical payment key, e.g. `bonus:<user>` or
 * `lock:<paymentHash>`. Breez `sendPayment` takes an idempotency key that must be a UUID;
 * reusing the same UUID guarantees the payment is made once.
 */
export function idempotencyUuid(key: string): string {
  const b = sha256(new TextEncoder().encode(`coinclash:v1:idem:${key}`)).slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
