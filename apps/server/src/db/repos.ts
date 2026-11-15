import type { MatchDoc } from '../match/types.js';

export interface UserDoc {
  /** Wallet identity pubkey. */
  readonly _id: string;
  readonly nickname: string;
  readonly sparkAddress: string;
  readonly createdAt: number;
  readonly lastLoginAt: number;
  /** Regtest welcome bonus (Phase 5). */
  readonly bonusPaidAt: number | null;
}

export class VersionConflictError extends Error {
  override readonly name = 'VersionConflictError';
}

export interface MatchRepo {
  insert(doc: MatchDoc): Promise<void>;
  get(id: string): Promise<MatchDoc | null>;
  getByInvite(inviteCode: string): Promise<MatchDoc | null>;
  /** Save iff the stored version is `doc.version - 1`; otherwise throw VersionConflictError. */
  save(doc: MatchDoc): Promise<void>;
  listForPlayer(player: string, limit: number): Promise<MatchDoc[]>;
  listUnfinished(): Promise<MatchDoc[]>;
  /** The match that issued this escrow deposit invoice. */
  getByInvoice(invoice: string): Promise<MatchDoc | null>;
  /** Matches (any status) with escrow payouts or refunds not yet paid. */
  listOpenPayouts(): Promise<MatchDoc[]>;
}

export interface UserRepo {
  get(id: string): Promise<UserDoc | null>;
  getMany(ids: readonly string[]): Promise<UserDoc[]>;
  upsert(doc: UserDoc): Promise<void>;
}

const FINAL = new Set(['SETTLED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'FAILED']);

/** In-memory repos: unit tests, and `MONGODB_URI=memory` for offline dev / E2E. */
export class MemoryMatchRepo implements MatchRepo {
  private readonly docs = new Map<string, MatchDoc>();

  async insert(doc: MatchDoc) {
    if (this.docs.has(doc._id)) throw new Error('Duplicate match id');
    this.docs.set(doc._id, structuredClone(doc));
  }
  async get(id: string) {
    const d = this.docs.get(id);
    return d ? structuredClone(d) : null;
  }
  async getByInvite(inviteCode: string) {
    for (const d of this.docs.values()) if (d.inviteCode === inviteCode) return structuredClone(d);
    return null;
  }
  async save(doc: MatchDoc) {
    const cur = this.docs.get(doc._id);
    if (!cur || cur.version !== doc.version - 1) throw new VersionConflictError(doc._id);
    this.docs.set(doc._id, structuredClone(doc));
  }
  async listForPlayer(player: string, limit: number) {
    return [...this.docs.values()]
      .filter((d) => d.challenger === player || d.opponent === player)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }
  async getByInvoice(invoice: string) {
    const d = [...this.docs.values()].find((x) => x.invoices.includes(invoice));
    return d ? structuredClone(d) : null;
  }
  async listOpenPayouts() {
    return [...this.docs.values()].filter((d) => d.payoutsOpen).map((d) => structuredClone(d));
  }
  async listUnfinished() {
    return [...this.docs.values()]
      .filter((d) => !FINAL.has(d.status))
      .map((d) => structuredClone(d));
  }
}

export class MemoryUserRepo implements UserRepo {
  private readonly docs = new Map<string, UserDoc>();
  async get(id: string) {
    return this.docs.get(id) ?? null;
  }
  async getMany(ids: readonly string[]) {
    return ids.flatMap((id) => (this.docs.has(id) ? [this.docs.get(id)!] : []));
  }
  async upsert(doc: UserDoc) {
    this.docs.set(doc._id, doc);
  }
}
