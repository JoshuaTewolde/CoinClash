import type { GameResult, GameSession } from '@coinclash/game-sdk';
import type { MatchStatus, Proposal } from '@coinclash/shared';

export interface Secret {
  /** 32-byte hex preimage that unlocks the HTLC paying this player. NEVER sent before the result. */
  readonly preimage: string;
  /** SHA-256 of the preimage (hex). */
  readonly hash: string;
}

export interface Transition {
  readonly from: MatchStatus | null;
  readonly to: MatchStatus;
  readonly at: number;
  readonly cause: string;
}

export type EscrowMode = 'escrow' | 'htlc';

/** One player's escrow deposit. */
export interface Deposit {
  readonly invoice: string | null;
  readonly paymentId: string | null;
  readonly paidAt: number | null;
}

/**
 * A money obligation of the escrow, embedded in the match (the match's ledger). Keyed by
 * `${kind}:${player}`; the escrow pays it with idempotency key `${kind}:${matchId}:${player}`,
 * so it is paid at most once even across crashes and retries.
 */
export interface Payout {
  readonly player: string;
  readonly kind: 'payout' | 'refund';
  readonly amount: number;
  readonly status: 'pending' | 'paid' | 'failed';
  readonly paymentId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

/** A match as persisted in MongoDB (`matches` collection). Plain data. */
export interface MatchDoc {
  readonly _id: string;
  readonly inviteCode: string;
  readonly gameId: string;
  readonly options: unknown;
  /** Seeds the game engine. Random per match. */
  readonly seed: string;
  readonly status: MatchStatus;
  /** How stakes are held. `escrow` is the active mode (ADR 0013); `htlc` is dormant (ADR 0002). */
  readonly mode: EscrowMode;
  readonly stake: number;
  readonly proposals: readonly Proposal[];
  readonly challenger: string;
  readonly opponent: string | null;
  /** Secret codes, keyed by the player they pay out to ("<player> wins"). */
  readonly secrets: Readonly<Record<string, Secret>> | null;
  /** HTLC expiry, Unix seconds. Every stake lock must expire no earlier than this. */
  readonly htlcExpiresAt: number | null;
  /** Unix ms by which both locks must be confirmed. */
  readonly lockDeadline: number | null;
  /** Keyed by the RECEIVER who confirmed (signed) seeing their opponent's lock. */
  readonly lockSeenBy: Readonly<Record<string, { paymentId: string; at: number }>>;
  readonly session: GameSession<unknown> | null;
  readonly turnStartedAt: number | null;
  readonly matchCapAt: number | null;
  readonly result: GameResult | null;
  /** Players whose winning code has been released to them. */
  readonly released: readonly string[];
  readonly claimDeadline: number | null;
  readonly claimedBy: readonly string[];
  /** Disconnected players mid-game: forfeit deadline (Unix ms). */
  readonly graceEndsAt: Readonly<Record<string, number>>;
  /** Escrow deposits per player (escrow mode). */
  readonly deposits: Readonly<Record<string, Deposit>>;
  /** All deposit invoices issued for this match (indexed, for matching incoming payments). */
  readonly invoices: readonly string[];
  /** Escrow obligations (payouts and refunds), keyed by `${kind}:${player}`. */
  readonly payouts: Readonly<Record<string, Payout>>;
  /** True while any payout is not yet paid (indexed, for reconcile after a crash). */
  readonly payoutsOpen: boolean;
  readonly rematchOf: string | null;
  readonly rematchId: string | null;
  readonly transitions: readonly Transition[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Optimistic-concurrency version, bumped on every save. */
  readonly version: number;
}

export function playersOf(doc: MatchDoc): string[] {
  return doc.opponent ? [doc.challenger, doc.opponent] : [doc.challenger];
}

export function opponentOf(doc: MatchDoc, player: string): string | null {
  if (player === doc.challenger) return doc.opponent;
  if (player === doc.opponent) return doc.challenger;
  return null;
}
