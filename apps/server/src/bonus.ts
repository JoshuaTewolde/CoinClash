/**
 * Regtest welcome bonus (spec §1): the house wallet sends new players test sats once per wallet
 * identity, rate-limited per IP, so a friend can go from invite link to first match in a minute.
 *
 * Exactly-once: `bonusPaidAt` is set BEFORE paying, and the payment uses a deterministic
 * idempotency key (`bonus:<user>`), so a retry or a crash can't pay twice. A failed payment
 * clears `bonusPaidAt` so a later login can try again.
 */
import type { HouseWallet } from './breez.js';
import type { UserRepo } from './db/repos.js';

export interface BonusDeps {
  readonly users: UserRepo;
  readonly house: HouseWallet;
  readonly amount: number;
  readonly perIpPerHour: number;
  readonly clock?: () => number;
  readonly log?: (msg: string, err?: unknown) => void;
}

export type BonusOutcome = 'sending' | 'already-paid' | 'rate-limited' | 'unknown-user';

export class WelcomeBonus {
  private readonly byIp = new Map<string, number[]>();
  private readonly inflight = new Set<string>();
  private readonly clock: () => number;

  constructor(private readonly deps: BonusDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  /**
   * Decide synchronously-ish and pay in the background.
   * Resolves with the outcome; `settled` resolves when the payment attempt finishes.
   */
  async grant(
    userId: string,
    ip: string,
  ): Promise<{ outcome: BonusOutcome; settled: Promise<void> }> {
    const done = Promise.resolve();
    const user = await this.deps.users.get(userId);
    if (!user) return { outcome: 'unknown-user', settled: done };
    if (user.bonusPaidAt !== null || this.inflight.has(userId))
      return { outcome: 'already-paid', settled: done };

    const now = this.clock();
    const recent = (this.byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.deps.perIpPerHour) {
      this.byIp.set(ip, recent);
      return { outcome: 'rate-limited', settled: done };
    }
    this.byIp.set(ip, [...recent, now]);

    this.inflight.add(userId);
    await this.deps.users.upsert({ ...user, bonusPaidAt: now });
    const settled = this.deps.house
      .pay(user.sparkAddress, this.deps.amount, `bonus:${userId}`)
      .then(
        () => undefined,
        async (err: unknown) => {
          this.deps.log?.(`welcome bonus to ${userId} failed`, err);
          const latest = await this.deps.users.get(userId);
          if (latest) await this.deps.users.upsert({ ...latest, bonusPaidAt: null });
        },
      )
      .finally(() => this.inflight.delete(userId));
    return { outcome: 'sending', settled };
  }
}
