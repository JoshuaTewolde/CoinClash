/**
 * Client ⇄ server protocol. Every HTTP body and socket payload is validated with these zod
 * schemas at the boundary (CLAUDE.md conventions). Match lifecycle: ADR 0002.
 */
import { z } from 'zod';
import type { Network } from './network.js';

export const MATCH_STATUSES = [
  'PROPOSED', // created by the challenger, nobody has opened the invite yet
  'NEGOTIATING', // opponent joined; proposals go back and forth
  'AWAITING_DEPOSITS', // stake agreed; both players pay their stake into escrow (ADR 0013)
  'AWAITING_LOCKS', // HTLC mode (dormant, ADR 0002): both players lock HTLCs to each other
  'IN_PROGRESS',
  'SETTLING', // result known; escrow paying out (or, HTLC mode, codes released awaiting claims)
  'SETTLED',
  'DECLINED',
  'CANCELLED', // locks not completed in time; any lock returns at expiry
  'EXPIRED', // claim window passed without a confirmed claim
  'FAILED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const FINAL_STATUSES: readonly MatchStatus[] = [
  'SETTLED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];

const id = z.string().min(1).max(128);
const sats = z
  .number()
  .int()
  .positive()
  .max(21_000_000 * 100_000_000);

export const SignedMessageSchema = z.object({
  message: z.string().min(1).max(512),
  pubkey: z.string().min(1).max(256),
  signature: z.string().min(1).max(512),
});

export const NicknameSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, _ . - only');

// ---- HTTP ----
export const LoginRequestSchema = z.object({
  nonce: z.string().min(16).max(128),
  signed: SignedMessageSchema,
  nickname: NicknameSchema.optional(),
  sparkAddress: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ---- Socket commands (client → server) ----
export const ClientCommands = {
  'match:create': z.object({
    gameId: id,
    stake: sats,
    options: z.unknown().optional(),
    /** Challenge a friend directly (someone you've played before): no link needed. */
    opponentId: id.optional(),
  }),
  'match:join': z.object({ inviteCode: z.string().min(6).max(32) }),
  'match:subscribe': z.object({ matchId: id }),
  'match:accept': z.object({ matchId: id }),
  'match:counter': z.object({ matchId: id, amount: sats }),
  'match:takeLower': z.object({ matchId: id }),
  'match:decline': z.object({ matchId: id }),
  /** "I can see my opponent's HTLC to me." Signed by the receiving wallet. */
  'match:lockSeen': z.object({
    matchId: id,
    paymentId: z.string().min(1).max(256),
    signed: SignedMessageSchema,
  }),
  'match:move': z.object({ matchId: id, move: z.unknown() }),
  'match:resign': z.object({ matchId: id }),
  /** "I claimed my winnings." Signed by the claiming wallet. */
  'match:claimed': z.object({ matchId: id, signed: SignedMessageSchema }),
  'match:rematch': z.object({ matchId: id }),
  /** "I paid my deposit": a hint to check the escrow now. Never trusted as proof of payment. */
  'match:paid': z.object({ matchId: id }),
} as const;
export type ClientCommandName = keyof typeof ClientCommands;
export type ClientCommand<N extends ClientCommandName> = z.infer<(typeof ClientCommands)[N]>;

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// ---- Server → client ----
export interface PlayerSummary {
  readonly id: string;
  readonly nickname: string;
}

export interface Proposal {
  readonly by: string;
  readonly amount: number;
  readonly at: number;
}

export interface LockInfo {
  /** Hash YOU must lock your stake to (your opponent's "wins" code). */
  readonly lockToHash: string;
  /** Hash your opponent locks to you under (your "wins" code). Watch for it. */
  readonly incomingHash: string;
  readonly opponentSparkAddress: string;
  /** Absolute Unix seconds. Send HTLCs with expiry ≥ this. */
  readonly htlcExpiresAt: number;
  /** Absolute Unix ms by which both locks must be seen. */
  readonly lockDeadline: number;
  /** Per player: has their opponent confirmed seeing this player's lock? */
  readonly locked: Readonly<Record<string, boolean>>;
}

export interface PayoutInfo {
  readonly player: string;
  /** `payout`: winnings (whole pot, or own stake back on a draw). `refund`: match never started. */
  readonly kind: 'payout' | 'refund';
  readonly amount: number;
  readonly status: 'pending' | 'paid' | 'failed';
}

/** Escrow state (ADR 0013). Present when the match uses custodial escrow. */
export interface EscrowInfo {
  /** Unix ms by which both deposits must arrive. */
  readonly deadline: number;
  /** Per player: has their deposit arrived? */
  readonly paid: Readonly<Record<string, boolean>>;
  /** The viewer's own deposit invoice (only ever sent to that player), or null until issued. */
  readonly yourInvoice: string | null;
  readonly payouts: readonly PayoutInfo[];
}

export interface GameInfo {
  readonly view: unknown;
  readonly waitingOn: readonly string[];
  readonly turnEndsAt: number | null;
  readonly result:
    | { status: 'ongoing' }
    | { status: 'win'; winner: string; reason: string }
    | { status: 'draw'; reason: string };
}

export interface MatchView {
  readonly id: string;
  readonly inviteCode: string;
  /** 6-digit code to join an open invite from another phone (null once someone joined). */
  readonly joinCode: string | null;
  readonly gameId: string;
  readonly status: MatchStatus;
  readonly stake: number;
  readonly proposals: readonly Proposal[];
  readonly challenger: PlayerSummary;
  readonly opponent: PlayerSummary | null;
  /** Viewer's player id, or null for a non-player. */
  readonly you: string | null;
  /** Player whose turn it is to respond to the latest proposal. */
  readonly respondent: string | null;
  /** `escrow` (active, ADR 0013) or `htlc` (dormant, ADR 0002). */
  readonly mode: 'escrow' | 'htlc';
  readonly escrow: EscrowInfo | null;
  readonly locks: LockInfo | null;
  readonly game: GameInfo | null;
  /** Claim window end (Unix ms), set once settling. */
  readonly claimDeadline: number | null;
  /** Players who have confirmed claiming their winnings. */
  readonly claimedBy: readonly string[];
  /** Opponent's disconnect-forfeit deadline (Unix ms) if they're offline mid-game. */
  readonly opponentGraceEndsAt: number | null;
  readonly rematchOf: string | null;
  readonly rematchId: string | null;
  /** Unix ms. */
  readonly createdAt: number;
  /** Unix ms. */
  readonly updatedAt: number;
}

/** Win/loss/draw counts. */
export interface Record3 {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

/** Head-to-head stats with one friend, from finished matches (ADR 0009). */
export interface FriendStats {
  readonly id: string;
  readonly nickname: string;
  /** Consecutive local days with a finished match, ending today or yesterday. */
  readonly streakDays: number;
  readonly gamesPlayed: number;
  /** Unix ms of the most recent finished match. */
  readonly lastPlayedAt: number;
  readonly record: Record3;
  readonly byGame: Readonly<Record<string, Record3>>;
}

/** Public server config (`GET /api/config`). */
export interface PublicConfig {
  /** Network this server runs matches on. */
  readonly network: Network;
  /** Networks a player may pick (ADR 0010). Only `network` for now. */
  readonly networks: readonly Network[];
  readonly stakeMin: number;
  readonly stakeMax: number;
  readonly games: readonly { id: string; name: string; turnModel: string }[];
  /** Regtest welcome bonus for new players, or 0 when off. */
  readonly welcomeBonusSats: number;
}

/** One line of a player's CoinClash money activity (`GET /api/activity`). */
export interface ActivityItem {
  readonly id: string;
  /** Unix ms. */
  readonly at: number;
  readonly kind: 'stake' | 'winnings' | 'refund' | 'bonus';
  readonly direction: 'in' | 'out';
  readonly amount: number;
  readonly gameId: string | null;
  readonly opponent: string | null;
  readonly matchId: string | null;
  readonly status: 'pending' | 'done' | 'failed';
}

/** Public invite preview (`GET /api/invites/:code`). */
export interface InvitePreview {
  readonly gameId: string;
  readonly gameName: string;
  readonly stake: number;
  readonly status: MatchStatus;
  readonly challenger: string;
}

export interface CodeRelease {
  readonly matchId: string;
  readonly preimage: string;
  readonly paymentHash: string;
}

export interface ServerEvents {
  'match:update': (view: MatchView) => void;
  'match:code': (release: CodeRelease) => void;
}
