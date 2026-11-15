/** Wallet identity of a player (the Breez identity pubkey in production). */
export type PlayerId = string;

/** Returned by `validateMove` when untrusted input is not a legal move. Never thrown. */
export interface InvalidMove {
  readonly invalid: true;
  readonly reason: string;
}

/** Why a game ended. The server uses this for logs and the result screen. */
export type ResultReason = 'normal' | 'forfeit' | 'timeout' | 'match-cap';

export type GameResult =
  | { readonly status: 'ongoing' }
  | { readonly status: 'win'; readonly winner: PlayerId; readonly reason: ResultReason }
  | { readonly status: 'draw'; readonly reason: ResultReason };

export interface InitContext {
  /** Exactly two players in v1, in seat order. */
  readonly players: readonly PlayerId[];
  /** Match seed. All randomness must derive from it (see `createRng`). */
  readonly seed: string;
  /** Game-specific options, already validated by `parseOptions`. */
  readonly options?: unknown;
}

/**
 * A game plug-in. It knows only the rules, nothing about money, sockets or timers.
 * Every function must be **pure and deterministic**: same inputs, same output, no I/O, no
 * `Math.random`, no `Date.now`. That makes engines unit-testable and move logs replayable.
 * See docs/writing-a-game.md and docs/decisions/0006-game-plugin-interface.md.
 */
export interface GamePlugin<State, Move, PublicView> {
  /** Stable machine id, e.g. "tictactoe". Stored in match records; never change it. */
  readonly id: string;
  /** Display name, e.g. "Tic-tac-toe". */
  readonly name: string;
  readonly minPlayers: 2;
  readonly maxPlayers: 2;
  /** `alternating`: one player acts at a time. `simultaneous`: everyone acts, then reveal. */
  readonly turnModel: 'alternating' | 'simultaneous';
  /** Per-turn timer the server enforces. */
  readonly defaultTurnSeconds: number;
  /**
   * Hard cap on total match length. Stake HTLC expiries are derived from it
   * (ADR 0002), so it must be a real upper bound. When it's reached, the server ends the game with
   * `onMatchCap` (default: draw).
   */
  readonly maxMatchSeconds: number;

  /** Validate creator-chosen options (e.g. RPS best-of). Default: no options allowed. */
  parseOptions?(raw: unknown): unknown | InvalidMove;

  init(ctx: InitContext): State;

  /** Players the server is currently waiting on (drives turn timers and "your turn" UI). */
  activePlayers(state: State): readonly PlayerId[];

  /** Parse untrusted input from `player`. Must never throw; return `InvalidMove` instead. */
  validateMove(state: State, player: PlayerId, move: unknown): Move | InvalidMove;

  /** Apply an already-validated move. Must not mutate `state`. */
  applyMove(state: State, player: PlayerId, move: Move): State;

  /** Status from the board alone. Forfeits and caps are layered on by the session helpers. */
  getResult(state: State): GameResult;

  /** What `player` may see (`null` = neutral observer). Must hide secret information. */
  viewFor(state: State, player: PlayerId | null): PublicView;

  /**
   * Called when `player` runs out of turn time. Return the next state, or `'forfeit'`
   * (the default when omitted) to make that player lose.
   */
  onTimeout?(state: State, player: PlayerId): State | 'forfeit';

  /** Result when `maxMatchSeconds` is hit while the game is ongoing. Default: draw. */
  onMatchCap?(state: State): GameResult;

  /** All legal moves for `player`. Optional; used by fuzz tests and future bots. */
  legalMoves?(state: State, player: PlayerId): readonly Move[];
}

/** Loosely-typed plug-in, for registries holding many games. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGamePlugin = GamePlugin<any, any, any>;

export function invalid(reason: string): InvalidMove {
  return { invalid: true, reason };
}

export function isInvalid(value: unknown): value is InvalidMove {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { invalid?: unknown }).invalid === true &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/**
 * Props every game's web board receives (`packages/games/<id>/src/Board.tsx`, export "./board").
 * Type-only, so game-sdk stays React-free and server-safe.
 */
export interface BoardProps<View = unknown, Move = unknown> {
  /** The player's view from `viewFor` (never hidden info). */
  readonly view: View;
  /** Viewer's player id, or null for a non-player. */
  readonly you: string | null;
  /** True when the server is waiting on this viewer's move. */
  readonly canMove: boolean;
  /** Send a move intent; the server validates it. */
  readonly onMove: (move: Move) => void;
  /** `review`: a finished game shown on the result screen. No controls; may replay the last move. */
  readonly mode?: 'play' | 'review';
}
