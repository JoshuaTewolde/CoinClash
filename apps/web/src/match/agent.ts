/**
 * MatchAgent: the client side of the HTLC "oracle" escrow (ADR 0002), so players never handle
 * hashes or codes themselves.
 *
 * - `lock(view)`: one tap. Locks the stake to the opponent under the opponent's "wins" hash.
 * - `sync(view)`: while locks are pending, watches for the opponent's lock to ME and, once it's
 *   there with the right amount and expiry, signs "lock seen" for the server.
 * - `onCode(release)`: when the server releases my winning code, claims the opponent's lock
 *   and signs "claimed".
 *
 * Every step is idempotent (in-flight guards plus checks against wallet state), because socket
 * updates repeat and the page may reload mid-step.
 */
import { signedMessages, type WalletRail } from '@coinclash/rail';
import type { CodeRelease, MatchView } from '@coinclash/shared';

export type Send = (event: string, payload: unknown) => Promise<unknown>;

export interface AgentDeps {
  readonly wallet: WalletRail;
  readonly send: Send;
  /** Unix seconds. */
  readonly nowSec?: () => number;
  /** Remembers which matches this device already locked (survives reloads). */
  readonly memory?: Pick<Storage, 'getItem' | 'setItem'>;
  readonly onError?: (err: unknown) => void;
}

const memoryKey = (matchId: string) => `cc.locked.${matchId}`;

export class MatchAgent {
  private readonly inflight = new Set<string>();
  private readonly confirmed = new Set<string>();
  private readonly claimed = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: AgentDeps) {
    this.now = deps.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Has this device already sent its lock for the match? */
  hasLocked(matchId: string): boolean {
    try {
      return this.deps.memory?.getItem(memoryKey(matchId)) === '1';
    } catch {
      return false;
    }
  }

  /**
   * Escrow mode (ADR 0013): pay my deposit invoice once, then nudge the server to check. The
   * server only starts the game after its escrow wallet sees the payment.
   */
  async payDeposit(view: MatchView): Promise<void> {
    const escrow = view.escrow;
    if (view.status !== 'AWAITING_DEPOSITS' || !escrow || !view.you) {
      throw new Error('Nothing to pay');
    }
    if (escrow.paid[view.you]) return;
    if (!escrow.yourInvoice) throw new Error('Getting your payment ready… try again in a second');
    // Spark transfer ids (= idempotency keys) are unique network-wide: include the payer.
    const key = `deposit:${view.id}:${view.you}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      // Same key → same payment: a double tap or a retry after reload never pays twice.
      await this.deps.wallet.payInvoice(escrow.yourInvoice, key);
      try {
        this.deps.memory?.setItem(memoryKey(view.id), '1');
      } catch {
        /* ignore */
      }
      await this.deps.send('match:paid', { matchId: view.id }).catch(() => undefined);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** HTLC mode (dormant, ADR 0002). */
  async lock(view: MatchView): Promise<void> {
    const locks = view.locks;
    if (view.status !== 'AWAITING_LOCKS' || !locks || !view.you) throw new Error('Nothing to lock');
    if (this.hasLocked(view.id) || locks.locked[view.you]) return;
    const key = `lock:${view.id}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const expirySecs = locks.htlcExpiresAt - this.now();
      if (expirySecs <= 60) throw new Error('Too late to lock for this match');
      await this.deps.wallet.lock({
        to: locks.opponentSparkAddress,
        amount: view.stake,
        paymentHash: locks.lockToHash,
        expirySecs,
      });
      try {
        this.deps.memory?.setItem(memoryKey(view.id), '1');
      } catch {
        /* ignore */
      }
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Call on every update. Returns true while it is still watching for the opponent's lock
   * (the caller polls again later).
   */
  async sync(view: MatchView): Promise<boolean> {
    const locks = view.locks;
    if (view.status !== 'AWAITING_LOCKS' || !locks || !view.you) return false;
    const opponent = view.you === view.challenger.id ? view.opponent?.id : view.challenger.id;
    if (!opponent) return false;
    // locked[opponent] = "the opponent's lock has been confirmed by its receiver (me)".
    if (locks.locked[opponent] || this.confirmed.has(view.id)) return false;
    const key = `seen:${view.id}`;
    if (this.inflight.has(key)) return true;
    this.inflight.add(key);
    try {
      const incoming = await this.deps.wallet.findIncomingLock(locks.incomingHash);
      if (
        !incoming ||
        incoming.status !== 'waiting' ||
        incoming.amount < view.stake ||
        incoming.expiresAt < locks.htlcExpiresAt
      ) {
        return true;
      }
      const signed = await this.deps.wallet.signMessage(
        signedMessages.lockSeen(view.id, locks.incomingHash, view.stake),
      );
      await this.deps.send('match:lockSeen', {
        matchId: view.id,
        paymentId: incoming.paymentId,
        signed,
      });
      this.confirmed.add(view.id);
      return false;
    } catch (err) {
      this.deps.onError?.(err);
      return true;
    } finally {
      this.inflight.delete(key);
    }
  }

  async onCode(release: CodeRelease): Promise<void> {
    const key = `claim:${release.paymentHash}`;
    if (this.claimed.has(key) || this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      try {
        await this.deps.wallet.claim(release.preimage);
      } catch (err) {
        // Already claimed (e.g. before a reload)? Then just confirm it.
        const lock = await this.deps.wallet.findIncomingLock(release.paymentHash);
        if (lock?.status !== 'claimed') throw err;
      }
      const signed = await this.deps.wallet.signMessage(
        signedMessages.claimed(release.matchId, release.paymentHash),
      );
      await this.deps.send('match:claimed', { matchId: release.matchId, signed });
      this.claimed.add(key);
    } catch (err) {
      this.deps.onError?.(err);
    } finally {
      this.inflight.delete(key);
    }
  }
}
