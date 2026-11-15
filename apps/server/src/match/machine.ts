/**
 * The match state machine (ADR 0013 escrow, active; ADR 0002 HTLC, dormant), as a **pure**
 * function: `(doc, command, env) → result`.
 * No I/O, no clocks, no randomness: `env` supplies time and secret generation. The service
 * (service.ts) persists results, schedules timers, verifies signatures and notifies clients.
 */
import {
  applyMatchCap,
  forfeit,
  sessionResult,
  startSession,
  submitMove,
  timeoutPlayer,
  waitingOn,
  type AnyGamePlugin,
  type GameSession,
} from '@coinclash/game-sdk';
import { FINAL_STATUSES, type MatchStatus } from '@coinclash/shared';
import {
  opponentOf,
  playersOf,
  type EscrowMode,
  type MatchDoc,
  type Payout,
  type Secret,
} from './types.js';

export class MatchError extends Error {
  override readonly name = 'MatchError';
}

export interface MachineConfig {
  readonly stakeMin: number;
  readonly stakeMax: number;
  readonly lockTimeoutMs: number;
  /** Seconds the winner has to claim, included in the HTLC expiry. */
  readonly claimWindowSeconds: number;
  readonly disconnectGraceMs: number;
}

export interface MachineEnv {
  readonly now: number;
  readonly plugins: ReadonlyMap<string, AnyGamePlugin>;
  readonly config: MachineConfig;
  /** Fresh random secrets, one per player. Only called when the stake is agreed. */
  readonly makeSecrets: (players: readonly string[]) => Record<string, Secret>;
}

export type MatchCommand =
  | { type: 'join'; player: string }
  | { type: 'accept'; player: string }
  | { type: 'counter'; player: string; amount: number }
  | { type: 'takeLower'; player: string }
  | { type: 'decline'; player: string }
  /** `player` confirmed (with a verified signature) that their opponent's lock reached them. */
  | { type: 'lockSeen'; player: string; paymentId: string }
  | { type: 'move'; player: string; move: unknown }
  | { type: 'resign'; player: string }
  | { type: 'connected'; player: string }
  | { type: 'disconnected'; player: string }
  /** `player` confirmed (with a verified signature) claiming their winnings. */
  | { type: 'claimed'; player: string }
  /** Escrow: deposit invoices were issued (by the service, from the escrow wallet). */
  | { type: 'invoicesIssued'; invoices: Readonly<Record<string, string>> }
  /** Escrow: the escrow wallet received `player`'s deposit (detected server-side, never client-claimed). */
  | { type: 'depositReceived'; player: string; paymentId: string; amount: number }
  /** Escrow: outcome of paying the obligation `key` (`${kind}:${player}`). */
  | { type: 'payoutResult'; key: string; ok: boolean; paymentId?: string; error?: string }
  /** Process every deadline that has passed. */
  | { type: 'tick' };

/** Side effects for the service to carry out after persisting. */
export type MatchNotice = { type: 'releaseCode'; to: string; preimage: string; hash: string };

export interface MachineResult {
  readonly doc: MatchDoc;
  readonly notices: readonly MatchNotice[];
}

export function isFinal(status: MatchStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export function pluginFor(env: MachineEnv, gameId: string): AnyGamePlugin {
  const plugin = env.plugins.get(gameId);
  if (!plugin) throw new MatchError(`Unknown game: ${gameId}`);
  return plugin;
}

export function validateStake(env: MachineEnv, amount: number): void {
  const { stakeMin, stakeMax } = env.config;
  if (!Number.isInteger(amount) || amount < stakeMin || amount > stakeMax) {
    throw new MatchError(`Stake must be between ${stakeMin} and ${stakeMax} sats`);
  }
}

function to(doc: MatchDoc, status: MatchStatus, now: number, cause: string): MatchDoc {
  return {
    ...doc,
    status,
    transitions: [...doc.transitions, { from: doc.status, to: status, at: now, cause }],
  };
}

export interface NewMatchParams {
  readonly id: string;
  readonly inviteCode: string;
  readonly joinCode?: string | null;
  readonly seed: string;
  readonly gameId: string;
  readonly options: unknown;
  readonly stake: number;
  readonly challenger: string;
  readonly now: number;
  /** Defaults to `escrow`, the active mode (ADR 0013). */
  readonly mode?: EscrowMode;
}

/** A fresh PROPOSED match. Ids and seed are passed in so this stays pure. */
export function createMatchDoc(p: NewMatchParams): MatchDoc {
  return {
    _id: p.id,
    inviteCode: p.inviteCode,
    joinCode: p.joinCode ?? null,
    gameId: p.gameId,
    options: p.options ?? null,
    seed: p.seed,
    status: 'PROPOSED',
    mode: p.mode ?? 'escrow',
    stake: p.stake,
    proposals: [{ by: p.challenger, amount: p.stake, at: p.now }],
    challenger: p.challenger,
    opponent: null,
    secrets: null,
    htlcExpiresAt: null,
    lockDeadline: null,
    lockSeenBy: {},
    session: null,
    turnStartedAt: null,
    matchCapAt: null,
    result: null,
    released: [],
    claimDeadline: null,
    claimedBy: [],
    graceEndsAt: {},
    deposits: {},
    invoices: [],
    payouts: {},
    payoutsOpen: false,
    rematchOf: null,
    rematchId: null,
    transitions: [{ from: null, to: 'PROPOSED', at: p.now, cause: `${p.challenger} challenged` }],
    createdAt: p.now,
    updatedAt: p.now,
    version: 1,
  };
}

/** The player expected to answer the latest proposal. */
export function respondentOf(doc: MatchDoc): string | null {
  if (doc.status !== 'NEGOTIATING' || !doc.opponent) return null;
  const last = doc.proposals.at(-1);
  if (!last) return null;
  return opponentOf(doc, last.by);
}

function requirePlayer(doc: MatchDoc, player: string): void {
  if (!playersOf(doc).includes(player)) throw new MatchError('You are not in this match');
}

function requireStatus(doc: MatchDoc, ...statuses: MatchStatus[]): void {
  if (!statuses.includes(doc.status)) {
    throw new MatchError(`Not allowed while the match is ${doc.status}`);
  }
}

function requireRespondent(doc: MatchDoc, player: string): void {
  requireStatus(doc, 'NEGOTIATING');
  if (respondentOf(doc) !== player) throw new MatchError('Waiting for the other player to respond');
}

function agree(doc: MatchDoc, stake: number, env: MachineEnv, cause: string): MatchDoc {
  const plugin = pluginFor(env, doc.gameId);
  const players = playersOf(doc);
  if (doc.mode === 'escrow') {
    // ADR 0013: both pay their stake into escrow; the service issues the invoices next.
    return {
      ...to(doc, 'AWAITING_DEPOSITS', env.now, cause),
      stake,
      lockDeadline: env.now + env.config.lockTimeoutMs,
      deposits: Object.fromEntries(
        players.map((p) => [p, { invoice: null, paymentId: null, paidAt: null }]),
      ),
    };
  }
  const lockTimeoutSecs = Math.ceil(env.config.lockTimeoutMs / 1000);
  return {
    ...to(doc, 'AWAITING_LOCKS', env.now, cause),
    stake,
    secrets: env.makeSecrets(players),
    lockDeadline: env.now + env.config.lockTimeoutMs,
    // lock window + longest possible game + claim window (ADR 0002 "Deadline").
    htlcExpiresAt:
      Math.ceil(env.now / 1000) +
      lockTimeoutSecs +
      plugin.maxMatchSeconds +
      env.config.claimWindowSeconds,
  };
}

function startGame(doc: MatchDoc, env: MachineEnv): MatchDoc {
  const plugin = pluginFor(env, doc.gameId);
  const session = startSession(plugin, {
    players: playersOf(doc),
    seed: doc.seed,
    options: doc.options,
  }) as GameSession<unknown>;
  return {
    ...to(
      doc,
      'IN_PROGRESS',
      env.now,
      doc.mode === 'escrow' ? 'both stakes secured' : 'both stakes locked',
    ),
    session,
    turnStartedAt: env.now,
    matchCapAt: env.now + plugin.maxMatchSeconds * 1000,
  };
}

const payoutKey = (kind: Payout['kind'], player: string) => `${kind}:${player}`;

/** Add escrow obligations; recomputes `payoutsOpen`. */
function addPayouts(
  doc: MatchDoc,
  items: readonly { player: string; kind: Payout['kind']; amount: number }[],
): MatchDoc {
  const payouts = { ...doc.payouts };
  for (const i of items) {
    const key = payoutKey(i.kind, i.player);
    if (payouts[key] || i.amount <= 0) continue; // never create the same obligation twice
    payouts[key] = { ...i, status: 'pending', paymentId: null, attempts: 0, lastError: null };
  }
  return { ...doc, payouts, payoutsOpen: Object.values(payouts).some((p) => p.status !== 'paid') };
}

/** Refund every deposit that arrived (match cancelled before the game started). */
function refundDeposits(doc: MatchDoc): MatchDoc {
  return addPayouts(
    doc,
    Object.entries(doc.deposits)
      .filter(([, d]) => d.paymentId !== null)
      .map(([player]) => ({ player, kind: 'refund' as const, amount: doc.stake })),
  );
}

/** If the game just ended, settle it: escrow pays out; HTLC mode releases the code(s). */
function settleIfOver(
  doc: MatchDoc,
  env: MachineEnv,
  notices: MatchNotice[],
  cause: string,
): MatchDoc {
  if (doc.status !== 'IN_PROGRESS' || !doc.session) return doc;
  const plugin = pluginFor(env, doc.gameId);
  const result = sessionResult(plugin, doc.session);
  if (result.status === 'ongoing') return doc;
  if (doc.mode === 'escrow') {
    // Win: the whole pot to the winner at once. Draw: each player's stake straight back.
    const items =
      result.status === 'win'
        ? [{ player: result.winner, kind: 'payout' as const, amount: doc.stake * 2 }]
        : playersOf(doc).map((p) => ({ player: p, kind: 'payout' as const, amount: doc.stake }));
    return addPayouts(
      {
        ...to(doc, 'SETTLING', env.now, `${cause}: ${result.status}`),
        result,
        turnStartedAt: null,
        graceEndsAt: {},
      },
      items,
    );
  }
  if (!doc.secrets) return doc;
  // Win: only the winner's code. Draw: both codes, so each side claims the other's
  // identical stake and the net is zero (ADR 0002 step 4).
  const released = result.status === 'win' ? [result.winner] : playersOf(doc);
  for (const p of released) {
    const secret = doc.secrets[p];
    if (secret)
      notices.push({ type: 'releaseCode', to: p, preimage: secret.preimage, hash: secret.hash });
  }
  return {
    ...to(doc, 'SETTLING', env.now, `${cause}: ${result.status}`),
    result,
    released,
    // Claims must land before the HTLCs expire; keep 30 s of safety margin.
    claimDeadline: (doc.htlcExpiresAt ?? 0) * 1000 - 30_000,
    turnStartedAt: null,
    graceEndsAt: {},
  };
}

function afterGameChange(
  prev: MatchDoc,
  doc: MatchDoc,
  env: MachineEnv,
  notices: MatchNotice[],
  cause: string,
): MatchDoc {
  const plugin = pluginFor(env, doc.gameId);
  const before = prev.session ? waitingOn(plugin, prev.session) : [];
  const after = doc.session ? waitingOn(plugin, doc.session) : [];
  // A new turn started if someone we now wait on wasn't being waited on before.
  const newTurn = after.some((p) => !before.includes(p));
  const next = newTurn ? { ...doc, turnStartedAt: env.now } : doc;
  return settleIfOver(next, env, notices, cause);
}

function tick(doc: MatchDoc, env: MachineEnv, notices: MatchNotice[]): MatchDoc {
  const { now } = env;
  switch (doc.status) {
    case 'AWAITING_LOCKS':
      if (doc.lockDeadline !== null && now >= doc.lockDeadline) {
        return to(doc, 'CANCELLED', now, 'lock window passed');
      }
      return doc;
    case 'AWAITING_DEPOSITS':
      if (doc.lockDeadline !== null && now >= doc.lockDeadline) {
        return refundDeposits(to(doc, 'CANCELLED', now, 'deposit window passed'));
      }
      return doc;
    case 'IN_PROGRESS': {
      const plugin = pluginFor(env, doc.gameId);
      let cur = doc;
      // Disconnect grace periods.
      for (const [player, ends] of Object.entries(cur.graceEndsAt)) {
        if (now >= ends && cur.session) {
          cur = { ...cur, session: forfeit(plugin, cur.session, player) };
          cur = settleIfOver(cur, env, notices, `${player} disconnected`);
          if (cur.status !== 'IN_PROGRESS') return cur;
        }
      }
      // Match cap.
      if (cur.matchCapAt !== null && now >= cur.matchCapAt && cur.session) {
        cur = { ...cur, session: applyMatchCap(plugin, cur.session) };
        return settleIfOver(cur, env, notices, 'match cap reached');
      }
      // Turn timer.
      if (
        cur.turnStartedAt !== null &&
        cur.session &&
        now >= cur.turnStartedAt + plugin.defaultTurnSeconds * 1000
      ) {
        const prev = cur;
        let session = cur.session;
        for (const p of waitingOn(plugin, session)) session = timeoutPlayer(plugin, session, p);
        cur = { ...cur, session, turnStartedAt: now };
        return afterGameChange(prev, cur, env, notices, 'turn timer');
      }
      return cur;
    }
    case 'SETTLING':
      if (doc.claimDeadline !== null && now >= doc.claimDeadline) {
        return to(doc, 'EXPIRED', now, 'claim window passed');
      }
      return doc;
    default:
      return doc;
  }
}

/** Apply one command. Throws `MatchError` for commands that aren't allowed. */
export function applyCommand(doc: MatchDoc, cmd: MatchCommand, env: MachineEnv): MachineResult {
  const notices: MatchNotice[] = [];
  const { now } = env;
  let next: MatchDoc;

  switch (cmd.type) {
    case 'join': {
      if (cmd.player === doc.challenger || cmd.player === doc.opponent) return { doc, notices };
      if (doc.opponent) throw new MatchError('This match already has two players');
      requireStatus(doc, 'PROPOSED');
      next = {
        ...to(doc, 'NEGOTIATING', now, 'opponent joined'),
        opponent: cmd.player,
        joinCode: null,
      };
      break;
    }
    case 'accept': {
      requireRespondent(doc, cmd.player);
      const last = doc.proposals.at(-1)!;
      next = agree(doc, last.amount, env, `${cmd.player} accepted ${last.amount}`);
      break;
    }
    case 'counter': {
      requireRespondent(doc, cmd.player);
      validateStake(env, cmd.amount);
      if (cmd.amount === doc.proposals.at(-1)!.amount) {
        throw new MatchError('That is the current proposal: accept it instead');
      }
      next = {
        ...doc,
        proposals: [...doc.proposals, { by: cmd.player, amount: cmd.amount, at: now }],
      };
      break;
    }
    case 'takeLower': {
      requireRespondent(doc, cmd.player);
      const lastTwo = doc.proposals.slice(-2).map((p) => p.amount);
      const lower = Math.min(...lastTwo);
      next = agree(doc, lower, env, `${cmd.player} took the lower: ${lower}`);
      break;
    }
    case 'decline': {
      requirePlayer(doc, cmd.player);
      requireStatus(doc, 'PROPOSED', 'NEGOTIATING');
      next = to(doc, 'DECLINED', now, `${cmd.player} declined`);
      break;
    }
    case 'lockSeen': {
      requirePlayer(doc, cmd.player);
      requireStatus(doc, 'AWAITING_LOCKS');
      if (doc.lockSeenBy[cmd.player]) return { doc, notices }; // idempotent: duplicate events
      next = {
        ...doc,
        lockSeenBy: { ...doc.lockSeenBy, [cmd.player]: { paymentId: cmd.paymentId, at: now } },
      };
      if (playersOf(next).every((p) => next.lockSeenBy[p])) next = startGame(next, env);
      break;
    }
    case 'move': {
      requirePlayer(doc, cmd.player);
      requireStatus(doc, 'IN_PROGRESS');
      const plugin = pluginFor(env, doc.gameId);
      const outcome = submitMove(plugin, doc.session!, cmd.player, cmd.move);
      if (!outcome.ok) throw new MatchError(outcome.reason);
      next = afterGameChange(
        doc,
        { ...doc, session: outcome.session },
        env,
        notices,
        `${cmd.player} moved`,
      );
      break;
    }
    case 'resign': {
      requirePlayer(doc, cmd.player);
      requireStatus(doc, 'IN_PROGRESS');
      const plugin = pluginFor(env, doc.gameId);
      next = { ...doc, session: forfeit(plugin, doc.session!, cmd.player) };
      next = settleIfOver(next, env, notices, `${cmd.player} resigned`);
      break;
    }
    case 'disconnected': {
      if (doc.status !== 'IN_PROGRESS' || !playersOf(doc).includes(cmd.player))
        return { doc, notices };
      if (doc.graceEndsAt[cmd.player] !== undefined) return { doc, notices };
      next = {
        ...doc,
        graceEndsAt: { ...doc.graceEndsAt, [cmd.player]: now + env.config.disconnectGraceMs },
      };
      break;
    }
    case 'connected': {
      if (doc.graceEndsAt[cmd.player] === undefined) return { doc, notices };
      const { [cmd.player]: _gone, ...rest } = doc.graceEndsAt;
      next = { ...doc, graceEndsAt: rest };
      break;
    }
    case 'claimed': {
      requireStatus(doc, 'SETTLING');
      if (!doc.released.includes(cmd.player)) throw new MatchError('No winnings to claim');
      if (doc.claimedBy.includes(cmd.player)) return { doc, notices };
      next = { ...doc, claimedBy: [...doc.claimedBy, cmd.player] };
      if (next.released.every((p) => next.claimedBy.includes(p))) {
        next = to(next, 'SETTLED', now, 'winnings claimed');
      }
      break;
    }
    case 'invoicesIssued': {
      requireStatus(doc, 'AWAITING_DEPOSITS');
      const deposits = { ...doc.deposits };
      const invoices = [...doc.invoices];
      for (const [player, invoice] of Object.entries(cmd.invoices)) {
        const d = deposits[player];
        if (!d || d.invoice) continue; // only the first invoice per player counts
        deposits[player] = { ...d, invoice };
        invoices.push(invoice);
      }
      next = { ...doc, deposits, invoices };
      break;
    }
    case 'depositReceived': {
      const d = doc.deposits[cmd.player];
      if (!d) throw new MatchError('No deposit expected from this player');
      if (d.paymentId) return { doc, notices }; // idempotent: duplicate events / polls
      const paid = { ...d, paymentId: cmd.paymentId, paidAt: now };
      next = { ...doc, deposits: { ...doc.deposits, [cmd.player]: paid } };
      if (doc.status !== 'AWAITING_DEPOSITS') {
        // Arrived after the window closed: the money is ours to return.
        next = addPayouts(next, [{ player: cmd.player, kind: 'refund', amount: cmd.amount }]);
      } else if (cmd.amount < doc.stake) {
        // Underpaid (fixed-amount invoices make this unlikely): refund it and treat as unpaid.
        next = addPayouts(doc, [{ player: cmd.player, kind: 'refund', amount: cmd.amount }]);
      } else if (playersOf(next).every((p) => next.deposits[p]?.paymentId)) {
        next = startGame(next, env);
      }
      break;
    }
    case 'payoutResult': {
      const p = doc.payouts[cmd.key];
      if (!p) throw new MatchError('Unknown payout');
      if (p.status === 'paid') return { doc, notices };
      const updated: Payout = cmd.ok
        ? { ...p, status: 'paid', paymentId: cmd.paymentId ?? null, lastError: null, paidAt: now }
        : { ...p, status: 'failed', attempts: p.attempts + 1, lastError: cmd.error ?? 'failed' };
      const payouts = { ...doc.payouts, [cmd.key]: updated };
      const open = Object.values(payouts).some((x) => x.status !== 'paid');
      next = { ...doc, payouts, payoutsOpen: open };
      if (!open && doc.status === 'SETTLING') next = to(next, 'SETTLED', now, 'winnings paid');
      break;
    }
    case 'tick':
      next = tick(doc, env, notices);
      if (next === doc) return { doc, notices };
      break;
  }
  return { doc: { ...next, updatedAt: now }, notices };
}

/** The next moment a `tick` would change something, or null. Used to schedule timers. */
export function nextDeadline(
  doc: MatchDoc,
  plugins: ReadonlyMap<string, AnyGamePlugin>,
): number | null {
  const candidates: number[] = [];
  switch (doc.status) {
    case 'AWAITING_LOCKS':
    case 'AWAITING_DEPOSITS':
      if (doc.lockDeadline !== null) candidates.push(doc.lockDeadline);
      break;
    case 'IN_PROGRESS': {
      const plugin = plugins.get(doc.gameId);
      if (doc.matchCapAt !== null) candidates.push(doc.matchCapAt);
      if (plugin && doc.turnStartedAt !== null) {
        candidates.push(doc.turnStartedAt + plugin.defaultTurnSeconds * 1000);
      }
      candidates.push(...Object.values(doc.graceEndsAt));
      break;
    }
    case 'SETTLING':
      if (doc.claimDeadline !== null) candidates.push(doc.claimDeadline);
      break;
    default:
      break;
  }
  return candidates.length ? Math.min(...candidates) : null;
}
