/**
 * MatchService: runs the pure state machine against storage, timers and clients.
 * - Serializes commands per match (in-process mutex) and saves with optimistic versioning.
 * - Verifies wallet signatures for lock and claim confirmations (ADR 0002 step 2/3).
 * - Keeps one timer per match for its next deadline; `reconcile()` rebuilds them on boot.
 * - Re-sends released codes whenever the winner reconnects, until they confirm the claim.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { isInvalid, type AnyGamePlugin } from '@coinclash/game-sdk';
import {
  paymentHashOf,
  signedMessages,
  type SignatureVerifier,
  type SignedMessage,
} from '@coinclash/rail';
import type { CodeRelease, MatchView } from '@coinclash/shared';
import type { MatchRepo, UserRepo } from '../db/repos.js';
import {
  applyCommand,
  createMatchDoc,
  isFinal,
  MatchError,
  nextDeadline,
  pluginFor,
  validateStake,
  type MachineConfig,
  type MachineEnv,
  type MatchCommand,
  type MatchNotice,
} from './machine.js';
import { playersOf, type MatchDoc, type Secret } from './types.js';
import { viewFor, type UserInfo } from './view.js';

export interface MatchEvents {
  /** The match changed: push fresh views to its players. */
  changed(doc: MatchDoc): void;
  /** Privately deliver a released secret code to the player it pays. */
  codeReleased(player: string, release: CodeRelease): void;
}

export interface MatchServiceDeps {
  readonly matches: MatchRepo;
  readonly users: UserRepo;
  readonly plugins: ReadonlyMap<string, AnyGamePlugin>;
  readonly verifier: SignatureVerifier;
  readonly config: MachineConfig;
  readonly events: MatchEvents;
  /** Unix ms. */
  readonly clock?: () => number;
}

export function makeSecrets(players: readonly string[]): Record<string, Secret> {
  return Object.fromEntries(
    players.map((p) => {
      const preimage = randomBytes(32).toString('hex');
      return [p, { preimage, hash: paymentHashOf(preimage) }];
    }),
  );
}

export class MatchService {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clock: () => number;
  private stopped = false;

  constructor(private readonly deps: MatchServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  private env(): MachineEnv {
    return { now: this.clock(), plugins: this.deps.plugins, config: this.deps.config, makeSecrets };
  }

  /** Run `fn` exclusively for `matchId`. */
  private exclusive<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(matchId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.queues.set(matchId, tail);
    void tail.then(() => {
      if (this.queues.get(matchId) === tail) this.queues.delete(matchId);
    });
    return run;
  }

  private async load(matchId: string): Promise<MatchDoc> {
    const doc = await this.deps.matches.get(matchId);
    if (!doc) throw new MatchError('Match not found');
    return doc;
  }

  /** Apply a command, persist, schedule, notify. */
  async command(matchId: string, cmd: MatchCommand): Promise<MatchDoc> {
    return this.exclusive(matchId, async () => {
      const doc = await this.load(matchId);
      const { doc: next, notices } = applyCommand(doc, cmd, this.env());
      if (next === doc) return doc;
      const saved = { ...next, version: doc.version + 1 };
      await this.deps.matches.save(saved);
      this.afterSave(saved, notices);
      return saved;
    });
  }

  private afterSave(doc: MatchDoc, notices: readonly MatchNotice[]): void {
    this.schedule(doc);
    for (const n of notices) {
      this.deps.events.codeReleased(n.to, {
        matchId: doc._id,
        preimage: n.preimage,
        paymentHash: n.hash,
      });
    }
    this.deps.events.changed(doc);
  }

  private schedule(doc: MatchDoc): void {
    const existing = this.timers.get(doc._id);
    if (existing) clearTimeout(existing);
    this.timers.delete(doc._id);
    if (this.stopped || isFinal(doc.status)) return;
    const at = nextDeadline(doc, this.deps.plugins);
    if (at === null) return;
    const delay = Math.max(0, at - this.clock());
    const timer = setTimeout(() => {
      this.timers.delete(doc._id);
      this.command(doc._id, { type: 'tick' }).catch((err) => {
        console.error(`[match ${doc._id}] tick failed`, err);
      });
    }, delay);
    timer.unref?.();
    this.timers.set(doc._id, timer);
  }

  async create(
    player: string,
    input: { gameId: string; stake: number; options?: unknown },
  ): Promise<MatchDoc> {
    const env = this.env();
    const plugin = pluginFor(env, input.gameId);
    validateStake(env, input.stake);
    let options: unknown = undefined;
    if (input.options !== undefined) {
      if (!plugin.parseOptions) throw new MatchError(`${plugin.name} has no options`);
      options = plugin.parseOptions(input.options);
      if (isInvalid(options)) throw new MatchError(options.reason);
    }
    const doc = createMatchDoc({
      id: randomUUID(),
      inviteCode: randomBytes(8).toString('base64url'),
      seed: randomBytes(16).toString('hex'),
      gameId: plugin.id,
      options,
      stake: input.stake,
      challenger: player,
      now: env.now,
    });
    await this.deps.matches.insert(doc);
    this.deps.events.changed(doc);
    return doc;
  }

  async join(player: string, inviteCode: string): Promise<MatchDoc> {
    const doc = await this.deps.matches.getByInvite(inviteCode);
    if (!doc) throw new MatchError('Invite not found');
    return this.command(doc._id, { type: 'join', player });
  }

  private async verifySigned(
    player: string,
    signed: SignedMessage,
    expected: string,
  ): Promise<void> {
    if (signed.pubkey !== player || signed.message !== expected) {
      throw new MatchError('Signed confirmation does not match this match');
    }
    if (!(await this.deps.verifier.verify(signed))) throw new MatchError('Invalid signature');
  }

  /** `player` reports their opponent's HTLC arrived. The signature binds match, hash and amount. */
  async lockSeen(
    player: string,
    input: { matchId: string; paymentId: string; signed: SignedMessage },
  ) {
    const doc = await this.load(input.matchId);
    const secret = doc.secrets?.[player];
    if (!secret) throw new MatchError('This match is not waiting for locks');
    await this.verifySigned(
      player,
      input.signed,
      signedMessages.lockSeen(doc._id, secret.hash, doc.stake),
    );
    return this.command(doc._id, { type: 'lockSeen', player, paymentId: input.paymentId });
  }

  async claimed(player: string, input: { matchId: string; signed: SignedMessage }) {
    const doc = await this.load(input.matchId);
    const secret = doc.secrets?.[player];
    if (!secret) throw new MatchError('No winnings to claim');
    await this.verifySigned(player, input.signed, signedMessages.claimed(doc._id, secret.hash));
    return this.command(doc._id, { type: 'claimed', player });
  }

  /** One-tap rematch: same game, players and stake, as a fresh proposal from `player`. */
  async rematch(player: string, matchId: string): Promise<MatchDoc> {
    const old = await this.load(matchId);
    if (!playersOf(old).includes(player)) throw new MatchError('You are not in this match');
    if (!old.result) throw new MatchError('This match has no result yet');
    if (old.rematchId) return this.load(old.rematchId);
    const other = playersOf(old).find((p) => p !== player)!;
    const created = await this.create(player, {
      gameId: old.gameId,
      stake: old.stake,
      ...(old.options !== null ? { options: old.options } : {}),
    });
    const now = this.clock();
    const fresh: MatchDoc = {
      ...created,
      status: 'NEGOTIATING',
      opponent: other,
      rematchOf: old._id,
      transitions: [
        ...created.transitions,
        { from: 'PROPOSED', to: 'NEGOTIATING', at: now, cause: 'rematch' },
      ],
      version: created.version + 1,
    };
    await this.deps.matches.save(fresh);
    this.deps.events.changed(fresh);
    await this.exclusive(old._id, async () => {
      const cur = await this.load(old._id);
      const linked = { ...cur, rematchId: fresh._id, version: cur.version + 1 };
      await this.deps.matches.save(linked);
      this.deps.events.changed(linked);
    });
    return fresh;
  }

  private async unfinishedFor(player: string): Promise<MatchDoc[]> {
    return (await this.deps.matches.listForPlayer(player, 100)).filter((d) => !isFinal(d.status));
  }

  /** First socket of `player` connected: cancel grace timers, re-send unclaimed codes. */
  async onConnect(player: string): Promise<void> {
    if (this.stopped) return;
    for (const doc of await this.unfinishedFor(player)) {
      const cur = await this.command(doc._id, { type: 'connected', player });
      if (
        cur.status === 'SETTLING' &&
        cur.released.includes(player) &&
        !cur.claimedBy.includes(player)
      ) {
        const s = cur.secrets?.[player];
        if (s)
          this.deps.events.codeReleased(player, {
            matchId: cur._id,
            preimage: s.preimage,
            paymentHash: s.hash,
          });
      }
    }
  }

  /** Last socket of `player` disconnected: start disconnect grace periods. */
  async onDisconnect(player: string): Promise<void> {
    // During shutdown every socket disconnects; that must not start forfeit timers.
    if (this.stopped) return;
    for (const doc of await this.unfinishedFor(player)) {
      await this.command(doc._id, { type: 'disconnected', player });
    }
  }

  /** On boot: process deadlines that passed while down, then re-arm timers. */
  async reconcile(): Promise<number> {
    const docs = await this.deps.matches.listUnfinished();
    for (const doc of docs) {
      const cur = await this.command(doc._id, { type: 'tick' });
      this.schedule(cur);
    }
    return docs.length;
  }

  async view(doc: MatchDoc, viewer: string | null): Promise<MatchView> {
    const users = await this.deps.users.getMany(playersOf(doc));
    const map = new Map<string, UserInfo>(users.map((u) => [u._id, u]));
    return viewFor(doc, viewer, pluginFor(this.env(), doc.gameId), map);
  }

  get(matchId: string): Promise<MatchDoc> {
    return this.load(matchId);
  }

  listFor(player: string, limit = 30): Promise<MatchDoc[]> {
    return this.deps.matches.listForPlayer(player, limit);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
