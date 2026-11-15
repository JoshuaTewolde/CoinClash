/**
 * Practice bot (ADR 0017): plays the same pure engines the server runs, entirely in the browser.
 * No money, no server. Good enough to be fun, beatable on purpose.
 */
import {
  submitMove,
  sessionResult,
  type AnyGamePlugin,
  type GameSession,
  type PlayerId,
} from '@coinclash/game-sdk';
import { connect4 } from '@coinclash/game-connect4/engine';
import { pool, type PoolState } from '@coinclash/game-pool/engine';
import { rps } from '@coinclash/game-rps/engine';
import { ticTacToe } from '@coinclash/game-tictactoe/engine';
import { correctChoice, trivia, type TriviaState } from '@coinclash/game-trivia/engine';

export const ENGINES: Readonly<Record<string, AnyGamePlugin>> = {
  tictactoe: ticTacToe,
  connect4,
  rps,
  trivia,
  pool,
};

export const YOU = 'you';
export const BOT = 'bot';

type Rand = () => number;

const pick = <T>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)] as T;

/** Result for `player` after `move`, or null if the move is rejected. */
function after(
  plugin: AnyGamePlugin,
  s: GameSession<unknown>,
  player: PlayerId,
  move: unknown,
): GameSession<unknown> | null {
  const out = submitMove(plugin, s, player, move);
  return out.ok ? out.session : null;
}

const wins = (plugin: AnyGamePlugin, s: GameSession<unknown>, player: PlayerId) => {
  const r = sessionResult(plugin, s);
  return r.status === 'win' && r.winner === player;
};

/**
 * Board games: win if possible, otherwise avoid moves that hand the opponent an immediate win
 * (this also blocks), preferring the centre. `slip` is the chance it skips the safety check.
 */
function boardMove(
  plugin: AnyGamePlugin,
  s: GameSession<unknown>,
  bot: PlayerId,
  rand: Rand,
  centre: (m: unknown) => number,
  slip: number,
): unknown {
  const human = s.ctx.players.find((p) => p !== bot)!;
  const moves = plugin.legalMoves!(s.state, bot);
  for (const m of moves) {
    const next = after(plugin, s, bot, m);
    if (next && wins(plugin, next, bot)) return m;
  }
  const safe =
    rand() < slip
      ? moves
      : moves.filter((m) => {
          const next = after(plugin, s, bot, m);
          if (!next) return false;
          return !plugin.legalMoves!(next.state, human).some((r) => {
            const n2 = after(plugin, next, human, r);
            return n2 !== null && wins(plugin, n2, human);
          });
        });
  const pool = safe.length ? safe : moves;
  const best = Math.max(...pool.map(centre));
  return pick(
    pool.filter((m) => centre(m) >= best - (rand() < 0.4 ? 1 : 0)),
    rand,
  );
}

/** Pool: try aimed shots near every ball at a few powers and keep the best outcome. */
function poolMove(s: GameSession<unknown>, bot: PlayerId, rand: Rand): unknown {
  const st = s.state as PoolState;
  const seat = st.players.indexOf(bot) as 0 | 1;
  const base = pool.legalMoves!(st, bot) as { angle: number; power: number }[];
  const candidates: { angle: number; power: number }[] = [];
  for (const m of base) {
    for (const d of [-2000, 0, 2000]) {
      for (const power of [45, 75]) {
        candidates.push({ angle: (m.angle + d + 360000) % 360000, power });
      }
    }
  }
  const before = st.pottedBy[seat].length;
  let best: { m: unknown; score: number } = { m: pick(base, rand), score: -Infinity };
  for (const m of candidates) {
    const next = after(pool, s, bot, m);
    if (!next) continue;
    const n = next.state as PoolState;
    let score = rand() * 2;
    if (n.winner === seat) score += 1000;
    else if (n.winner !== null) score -= 1000;
    score += (n.pottedBy[seat].length - before) * 10;
    if (n.turn === seat) score += 5;
    if (n.lastShot?.foul) score -= 8;
    if (score > best.score) best = { m, score };
  }
  return best.m;
}

/** The bot's move, or null if it has nothing to do right now. */
export function botMove(
  gameId: string,
  s: GameSession<unknown>,
  bot: PlayerId = BOT,
  rand: Rand = Math.random,
): unknown {
  const plugin = ENGINES[gameId];
  if (!plugin?.legalMoves) return null;
  const moves = plugin.legalMoves(s.state, bot);
  if (moves.length === 0) return null;
  switch (gameId) {
    case 'tictactoe':
      return boardMove(
        plugin,
        s,
        bot,
        rand,
        (m) => {
          const c = (m as { cell: number }).cell;
          return c === 4 ? 2 : c % 2 === 0 ? 1 : 0;
        },
        0.2,
      );
    case 'connect4':
      return boardMove(
        plugin,
        s,
        bot,
        rand,
        (m) => 3 - Math.abs((m as { column: number }).column - 3),
        0.15,
      );
    case 'trivia': {
      const st = s.state as TriviaState;
      const q = st.answers.length - 1;
      const right = correctChoice(st, q);
      // Knows about 6 in 10 answers.
      if (rand() < 0.6) return { question: q, choice: right };
      return pick(
        moves.filter((m) => (m as { choice: number }).choice !== right),
        rand,
      );
    }
    case 'pool':
      return poolMove(s, bot, rand);
    default:
      return pick(moves, rand);
  }
}
