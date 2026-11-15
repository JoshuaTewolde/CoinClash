import {
  isInvalid,
  type AnyGamePlugin,
  type GamePlugin,
  type GameResult,
  type InitContext,
  type InvalidMove,
  type PlayerId,
  type ResultReason,
} from './types.js';

/**
 * Everything that can happen to a game, in order. Persisting this log (plus the init context)
 * is enough to rebuild any match exactly with `replaySession`.
 */
export type GameEvent =
  | { readonly type: 'move'; readonly player: PlayerId; readonly move: unknown }
  | { readonly type: 'timeout'; readonly player: PlayerId }
  | { readonly type: 'forfeit'; readonly player: PlayerId }
  | { readonly type: 'match-cap' };

/**
 * A game in progress, as the server holds it. Wraps plug-in state with results the plug-in
 * doesn't model itself (forfeits, timeouts, match cap). Plain data, safe to persist.
 */
export interface GameSession<State> {
  readonly gameId: string;
  readonly ctx: InitContext;
  readonly state: State;
  /** Set when the game ended outside the board rules (forfeit, timeout, cap). */
  readonly override: GameResult | null;
  readonly events: readonly GameEvent[];
}

export type SubmitOutcome<State> =
  | { readonly ok: true; readonly session: GameSession<State> }
  | { readonly ok: false; readonly reason: string };

export function startSession<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  ctx: InitContext,
): GameSession<S> {
  if (ctx.players.length < plugin.minPlayers || ctx.players.length > plugin.maxPlayers) {
    throw new RangeError(`${plugin.id} needs ${plugin.minPlayers}-${plugin.maxPlayers} players`);
  }
  if (new Set(ctx.players).size !== ctx.players.length) {
    throw new RangeError('Players must be distinct');
  }
  return { gameId: plugin.id, ctx, state: plugin.init(ctx), override: null, events: [] };
}

export function sessionResult<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
): GameResult {
  return session.override ?? plugin.getResult(session.state);
}

export function isOver<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
): boolean {
  return sessionResult(plugin, session).status !== 'ongoing';
}

/** Players the server is waiting on; empty once the game is over. */
export function waitingOn<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
): readonly PlayerId[] {
  return isOver(plugin, session) ? [] : plugin.activePlayers(session.state);
}

/**
 * The single entry point for untrusted moves. It checks the game is live, the sender is a player
 * whose turn it is, and that the plug-in accepts the move, then applies it. It never throws on
 * bad input.
 */
export function submitMove<S, M>(
  plugin: GamePlugin<S, M, unknown>,
  session: GameSession<S>,
  player: PlayerId,
  rawMove: unknown,
): SubmitOutcome<S> {
  if (isOver(plugin, session)) return { ok: false, reason: 'Game is over' };
  if (!session.ctx.players.includes(player))
    return { ok: false, reason: 'Not a player in this game' };
  if (!plugin.activePlayers(session.state).includes(player)) {
    return { ok: false, reason: 'Not your turn' };
  }
  let parsed: M | InvalidMove;
  try {
    parsed = plugin.validateMove(session.state, player, rawMove);
  } catch {
    // validateMove must not throw, but a buggy plug-in must not crash the server either.
    return { ok: false, reason: 'Invalid move' };
  }
  if (isInvalid(parsed)) return { ok: false, reason: parsed.reason };
  const state = plugin.applyMove(session.state, player, parsed);
  return {
    ok: true,
    session: {
      ...session,
      state,
      events: [...session.events, { type: 'move', player, move: parsed }],
    },
  };
}

function otherPlayer(session: GameSession<unknown>, player: PlayerId): PlayerId {
  const other = session.ctx.players.find((p) => p !== player);
  if (other === undefined) throw new RangeError('No opponent');
  return other;
}

function endWithLoss<S>(
  session: GameSession<S>,
  loser: PlayerId,
  reason: ResultReason,
  event: GameEvent,
): GameSession<S> {
  return {
    ...session,
    override: { status: 'win', winner: otherPlayer(session, loser), reason },
    events: [...session.events, event],
  };
}

/** `player` ran out of turn time. Uses the plug-in's `onTimeout`, or forfeits by default. */
export function timeoutPlayer<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
  player: PlayerId,
): GameSession<S> {
  if (!waitingOn(plugin, session).includes(player)) return session;
  const event: GameEvent = { type: 'timeout', player };
  const next = plugin.onTimeout ? plugin.onTimeout(session.state, player) : 'forfeit';
  if (next === 'forfeit') return endWithLoss(session, player, 'timeout', event);
  return { ...session, state: next, events: [...session.events, event] };
}

/** `player` resigned or was disconnected past the grace period. */
export function forfeit<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
  player: PlayerId,
): GameSession<S> {
  if (isOver(plugin, session) || !session.ctx.players.includes(player)) return session;
  return endWithLoss(session, player, 'forfeit', { type: 'forfeit', player });
}

/** The match hit `maxMatchSeconds`. */
export function applyMatchCap<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  session: GameSession<S>,
): GameSession<S> {
  if (isOver(plugin, session)) return session;
  const capped = plugin.onMatchCap?.(session.state);
  const override: GameResult =
    capped && capped.status !== 'ongoing' ? capped : { status: 'draw', reason: 'match-cap' };
  return { ...session, override, events: [...session.events, { type: 'match-cap' }] };
}

/** Rebuild a session from its init context and event log. Throws if the log is not legal. */
export function replaySession<S>(
  plugin: GamePlugin<S, unknown, unknown>,
  ctx: InitContext,
  events: readonly GameEvent[],
): GameSession<S> {
  let session = startSession(plugin, ctx);
  events.forEach((event, i) => {
    switch (event.type) {
      case 'move': {
        const outcome = submitMove(plugin, session, event.player, event.move);
        if (!outcome.ok) throw new Error(`Replay failed at event ${i}: ${outcome.reason}`);
        session = outcome.session;
        break;
      }
      case 'timeout':
        session = timeoutPlayer(plugin, session, event.player);
        break;
      case 'forfeit':
        session = forfeit(plugin, session, event.player);
        break;
      case 'match-cap':
        session = applyMatchCap(plugin, session);
        break;
    }
  });
  return session;
}

/** Registry of installed games, keyed by `id`. */
export function createRegistry(
  plugins: readonly AnyGamePlugin[],
): ReadonlyMap<string, AnyGamePlugin> {
  const map = new Map<string, AnyGamePlugin>();
  for (const p of plugins) {
    if (map.has(p.id)) throw new Error(`Duplicate game id: ${p.id}`);
    map.set(p.id, p);
  }
  return map;
}
