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

/** A match as persisted in MongoDB (`matches` collection). Plain data. */
export interface MatchDoc {
  readonly _id: string;
  readonly inviteCode: string;
  readonly gameId: string;
  readonly options: unknown;
  /** Seeds the game engine. Random per match. */
  readonly seed: string;
  readonly status: MatchStatus;
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
