/**
 * Simplified 8-ball pool. Pure, deterministic plug-in: the server runs the physics
 * (`physics.ts`, integer math only), so both phones see the same shot.
 *
 * Rules:
 * - The rack order and the breaker come from the match seed.
 * - The first object ball legally potted (no scratch) assigns its group to the shooter.
 * - Potting one of your own group (with no foul) keeps your turn; anything else passes it.
 * - Fouls (turn passes): scratch (cue ball respawns at the head spot), no ball hit, or the first
 *   ball hit is not yours (the 8 is yours once your group is cleared; on an open table any ball
 *   but the 8 is fine).
 * - Potting the 8 wins if your group was already cleared and the shot was clean. Potting it
 *   early, with a scratch or after a foul loses.
 * - After `MAX_SHOTS` shots the player with fewer group balls left wins (else a draw).
 */
import {
  createRng,
  invalid,
  type GamePlugin,
  type GameResult,
  type InvalidMove,
  type PlayerId,
} from '@coinclash/game-sdk';
import { z } from 'zod';
import {
  angleTo,
  BALL_R,
  FOOT_SPOT,
  HEAD_SPOT,
  isFree,
  POCKETS,
  simulate,
  SUB,
  TABLE_H,
  TABLE_W,
  type Ball,
  type Pocket,
} from './physics.js';

export type Seat = 0 | 1;
export type Group = 'solids' | 'stripes';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7] as const;
export const STRIPES = [9, 10, 11, 12, 13, 14, 15] as const;
/** Shot cap: a hard upper bound so every game ends (see `capResult`). */
export const MAX_SHOTS = 150;

export interface PoolMove {
  /** Millidegrees, 0..359999. 0 = right, 90000 = down the screen. */
  readonly angle: number;
  /** 1..100. */
  readonly power: number;
}

export interface LastShot {
  readonly by: Seat;
  readonly angle: number;
  readonly power: number;
  /** Ball positions before the shot; `viewFor` re-simulates from these for the replay. */
  readonly before: readonly Ball[];
  readonly potted: readonly number[];
  readonly firstContact: number | null;
  readonly foul: Foul | null;
}

export type Foul = 'scratch' | 'no-contact' | 'wrong-ball';

export interface PoolState {
  readonly players: readonly [PlayerId, PlayerId];
  readonly balls: readonly Ball[];
  readonly turn: Seat;
  readonly groups: readonly [Group | null, Group | null];
  /** Balls each seat potted, in order. */
  readonly pottedBy: readonly [readonly number[], readonly number[]];
  readonly winner: Seat | null;
  readonly shots: number;
  readonly lastShot: LastShot | null;
}

export interface PoolBallView {
  readonly id: number;
  /** Table units. */
  readonly x: number;
  readonly y: number;
}

export interface PoolShotView {
  readonly by: PlayerId;
  readonly angle: number;
  readonly power: number;
  readonly potted: readonly number[];
  readonly firstContact: number | null;
  readonly foul: Foul | null;
  /** Shot number, so boards can tell a new shot from a re-render. */
  readonly shot: number;
  /** Animation frames: `[x0, y0, …]` per ball id in table units, -1 when potted. */
  readonly frames: readonly (readonly number[])[];
}

export interface PoolView {
  readonly table: {
    readonly width: number;
    readonly height: number;
    readonly ballRadius: number;
    readonly pockets: readonly Pocket[];
  };
  /** Balls still on the table, in table units. */
  readonly balls: readonly PoolBallView[];
  readonly groups: Readonly<Record<PlayerId, Group | null>>;
  readonly potted: Readonly<Record<PlayerId, readonly number[]>>;
  /** Player to shoot, or null when the game is over. */
  readonly turn: PlayerId | null;
  /** The viewer, or null for observers. */
  readonly you: PlayerId | null;
  readonly winner: PlayerId | null;
  readonly shots: number;
  readonly maxShots: number;
  readonly lastShot: PoolShotView | null;
}

const MoveSchema = z
  .object({
    angle: z.number().int().min(0).max(359999),
    power: z.number().int().min(1).max(100),
  })
  .strict();

export function groupOf(id: number): Group | null {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null;
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function otherGroup(g: Group): Group {
  return g === 'solids' ? 'stripes' : 'solids';
}

function seatOf(state: PoolState, player: PlayerId): Seat | null {
  const i = state.players.indexOf(player);
  return i === 0 || i === 1 ? i : null;
}

/** Group balls still on the table. */
export function remaining(balls: readonly Ball[], group: Group): number {
  return balls.filter((b) => b.on && groupOf(b.id) === group).length;
}

/** Triangle rack at the foot spot: 8 in the middle, one solid and one stripe on the back corners. */
export function rack(seed: string): Ball[] {
  const rng = createRng(seed);
  const order = rng.shuffle([...SOLIDS, ...STRIPES]) as number[];
  // Slots 0..14 by row; slot 4 is the centre of row 3, slots 10 and 14 the back corners.
  const slots: number[] = [];
  let k = 0;
  for (let s = 0; s < 15; s++) slots.push(s === 4 ? 8 : (order[k++] as number));
  const back = [10, 14] as const;
  const a = slots[back[0]] as number;
  if (groupOf(a) === groupOf(slots[back[1]] as number)) {
    // Swap the far corner with the first ball of the opposite group elsewhere.
    const swap = slots.findIndex(
      (id, i) => i !== back[0] && i !== back[1] && id !== 8 && groupOf(id) !== groupOf(a),
    );
    [slots[back[1]], slots[swap]] = [slots[swap] as number, slots[back[1]] as number];
  }
  const D = (2 * BALL_R + 1) * SUB; // ball spacing, a hair over touching
  const ROW = 33 * SUB; // ≥ D·√3/2
  const balls: Ball[] = [{ id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, on: true }];
  let slot = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      balls.push({
        id: slots[slot++] as number,
        x: FOOT_SPOT.x + row * ROW,
        y: FOOT_SPOT.y + Math.trunc(((2 * i - row) * D) / 2),
        on: true,
      });
    }
  }
  return balls.sort((p, q) => p.id - q.id);
}

/** Respawn spot for the cue ball after a scratch: the head spot, or the nearest free spot left of it. */
function respawnCue(balls: readonly Ball[]): Ball[] {
  let x = HEAD_SPOT.x;
  while (!isFree(balls, x, HEAD_SPOT.y, 0) && x > BALL_R * SUB) x -= SUB;
  return balls.map((b) => (b.id === 0 ? { id: 0, x, y: HEAD_SPOT.y, on: true } : b));
}

/** Result when the shot cap or match cap is hit: fewer group balls left wins. */
function capResult(state: PoolState, reason: 'normal' | 'match-cap'): GameResult {
  const [g0, g1] = state.groups;
  if (g0 === null || g1 === null) return { status: 'draw', reason };
  const r0 = remaining(state.balls, g0);
  const r1 = remaining(state.balls, g1);
  if (r0 === r1) return { status: 'draw', reason };
  return { status: 'win', winner: state.players[r0 < r1 ? 0 : 1], reason };
}

function result(state: PoolState): GameResult {
  if (state.winner !== null) {
    return { status: 'win', winner: state.players[state.winner], reason: 'normal' };
  }
  if (state.shots >= MAX_SHOTS) return capResult(state, 'normal');
  return { status: 'ongoing' };
}

function toUnits(balls: readonly Ball[]): PoolBallView[] {
  return balls
    .filter((b) => b.on)
    .map((b) => ({ id: b.id, x: Math.round(b.x / SUB), y: Math.round(b.y / SUB) }));
}

/** What the physics reports back for a shot (a subset of `SimResult`). */
export interface ShotOutcome {
  readonly balls: readonly Ball[];
  readonly potted: readonly number[];
  readonly firstContact: number | null;
}

/** Simulate and judge one shot. */
export function takeShot(state: PoolState, move: PoolMove): PoolState {
  return judgeShot(state, move, simulate(state.balls, move.angle, move.power));
}

/** Apply the rules to a shot outcome. Separate from the physics so rules are easy to test. */
export function judgeShot(state: PoolState, move: PoolMove, sim: ShotOutcome): PoolState {
  const shooter = state.turn;
  const scratch = sim.potted.includes(0);
  const objects = sim.potted.filter((id) => id !== 0);
  const eight = objects.includes(8);

  let groups: [Group | null, Group | null] = [state.groups[0], state.groups[1]];
  const mine = groups[shooter];
  // Target before the shot: your group, or the 8 once your group is cleared.
  const cleared = mine !== null && remaining(state.balls, mine) === 0;

  let foul: Foul | null = null;
  if (scratch) foul = 'scratch';
  else if (sim.firstContact === null) foul = 'no-contact';
  else if (
    mine === null
      ? sim.firstContact === 8
      : cleared
        ? sim.firstContact !== 8
        : groupOf(sim.firstContact) !== mine
  )
    foul = 'wrong-ball';

  // Open table: the first legally potted object ball assigns groups.
  if (mine === null && foul === null) {
    const first = objects.map(groupOf).find((g): g is Group => g !== null);
    if (first) {
      groups = shooter === 0 ? [first, otherGroup(first)] : [otherGroup(first), first];
    }
  }

  const pottedBy: [number[], number[]] = [[...state.pottedBy[0]], [...state.pottedBy[1]]];
  pottedBy[shooter].push(...objects);

  let winner: Seat | null = null;
  if (eight) winner = cleared && foul === null ? shooter : other(shooter);

  const myGroup = groups[shooter];
  const pottedOwn = myGroup !== null && objects.some((id) => groupOf(id) === myGroup);
  const keepsTurn = foul === null && pottedOwn;

  return {
    players: state.players,
    balls: scratch ? respawnCue(sim.balls) : sim.balls,
    turn: keepsTurn ? shooter : other(shooter),
    groups,
    pottedBy,
    winner,
    shots: state.shots + 1,
    lastShot: {
      by: shooter,
      angle: move.angle,
      power: move.power,
      before: state.balls,
      potted: sim.potted,
      firstContact: sim.firstContact,
      foul,
    },
  };
}

export const pool: GamePlugin<PoolState, PoolMove, PoolView> = {
  id: 'pool',
  name: 'Pool',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'alternating',
  defaultTurnSeconds: 60,
  // A real game is ~20–40 shots; 30 minutes is a generous hard cap for the stake HTLCs.
  maxMatchSeconds: 1800,

  init({ players, seed }) {
    const [a, b] = players;
    if (a === undefined || b === undefined || players.length !== 2) {
      throw new RangeError('Pool needs exactly 2 players');
    }
    const turn: Seat = createRng(`${seed}␟break`).int(2) === 0 ? 0 : 1;
    return {
      players: [a, b],
      balls: rack(seed),
      turn,
      groups: [null, null],
      pottedBy: [[], []],
      winner: null,
      shots: 0,
      lastShot: null,
    };
  },

  activePlayers(state) {
    return result(state).status === 'ongoing' ? [state.players[state.turn]] : [];
  },

  validateMove(state, player, move): PoolMove | InvalidMove {
    const seat = seatOf(state, player);
    if (seat === null) return invalid('Not a player in this game');
    if (result(state).status !== 'ongoing') return invalid('Game is over');
    if (seat !== state.turn) return invalid('Not your turn');
    const parsed = MoveSchema.safeParse(move);
    if (!parsed.success) return invalid('Move must be { angle: 0-359999, power: 1-100 }');
    return { angle: parsed.data.angle, power: parsed.data.power };
  },

  applyMove(state, _player, move) {
    return takeShot(state, move);
  },

  getResult: result,

  onMatchCap(state) {
    return capResult(state, 'match-cap');
  },

  viewFor(state, player) {
    const live = result(state).status === 'ongoing';
    const [p0, p1] = state.players;
    const last = state.lastShot;
    return {
      table: { width: TABLE_W, height: TABLE_H, ballRadius: BALL_R, pockets: POCKETS },
      balls: toUnits(state.balls),
      groups: { [p0]: state.groups[0], [p1]: state.groups[1] },
      potted: { [p0]: state.pottedBy[0], [p1]: state.pottedBy[1] },
      turn: live ? state.players[state.turn] : null,
      you: player !== null && seatOf(state, player) !== null ? player : null,
      winner: state.winner === null ? null : state.players[state.winner],
      shots: state.shots,
      maxShots: MAX_SHOTS,
      lastShot: last && {
        by: state.players[last.by],
        angle: last.angle,
        power: last.power,
        potted: last.potted,
        firstContact: last.firstContact,
        foul: last.foul,
        shot: state.shots,
        frames: simulate(last.before, last.angle, last.power).frames,
      },
    };
  },

  legalMoves(state, player) {
    if (seatOf(state, player) !== state.turn || result(state).status !== 'ongoing') return [];
    // The move space is continuous; offer aimed shots at every object ball plus a few blind ones.
    const cue = state.balls.find((b) => b.id === 0 && b.on);
    const moves: PoolMove[] = [];
    if (cue) {
      for (const b of state.balls) {
        if (!b.on || b.id === 0) continue;
        const angle = angleTo(b.x - cue.x, b.y - cue.y);
        moves.push({ angle, power: 35 }, { angle, power: 80 });
      }
    }
    for (const angle of [0, 90000, 180000, 270000]) moves.push({ angle, power: 50 });
    return moves;
  },
};

export default pool;
