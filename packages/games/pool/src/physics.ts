/**
 * Deterministic 2D pool physics. Integer math only: every value in the simulation path is an
 * integer well below 2^53, so +, -, *, Math.trunc(a / b) are exact and identical on every JS
 * engine. No Math.sin/cos/atan2 of floats: shot directions come from an integer CORDIC with a
 * hard-coded arctangent table, and square roots from an exact integer `isqrt`.
 *
 * Units: the table is `TABLE_W` × `TABLE_H` table units; positions and velocities are stored in
 * subunits (`SUB` per unit) so friction can work below one unit per step.
 */

/** Subunits per table unit. */
export const SUB = 1024;
/** Playfield size in table units (cushion nose to cushion nose). */
export const TABLE_W = 1000;
export const TABLE_H = 500;
/** Ball radius in table units. */
export const BALL_R = 18;
/** Max cue-ball speed in subunits per step (half a radius per step, so nothing tunnels). */
export const MAX_SPEED = 9 * SUB;
/** Hard cap on simulation steps; anything still rolling is stopped. */
export const MAX_STEPS = 3000;
/** Cap on animation frames returned by `simulate`. */
export const MAX_FRAMES = 240;

export const HEAD_SPOT = { x: (TABLE_W / 4) * SUB, y: (TABLE_H / 2) * SUB } as const;
export const FOOT_SPOT = { x: ((TABLE_W * 3) / 4) * SUB, y: (TABLE_H / 2) * SUB } as const;

export interface Pocket {
  /** Center and capture radius, in table units. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export const POCKETS: readonly Pocket[] = [
  { x: 0, y: 0, r: 40 },
  { x: TABLE_W / 2, y: -6, r: 34 },
  { x: TABLE_W, y: 0, r: 40 },
  { x: 0, y: TABLE_H, r: 40 },
  { x: TABLE_W / 2, y: TABLE_H + 6, r: 34 },
  { x: TABLE_W, y: TABLE_H, r: 40 },
];

export interface Ball {
  /** 0 = cue, 1–7 solids, 8 = eight ball, 9–15 stripes. */
  readonly id: number;
  /** Position in subunits. */
  readonly x: number;
  readonly y: number;
  /** False once potted. */
  readonly on: boolean;
}

export interface SimResult {
  /** Final positions (velocities are all zero at the end). */
  readonly balls: readonly Ball[];
  /** Ball ids in the order they dropped. */
  readonly potted: readonly number[];
  /** First ball the cue ball touched, or null. */
  readonly firstContact: number | null;
  /** Steps simulated. */
  readonly steps: number;
  /** Simulation steps between consecutive frames. */
  readonly stride: number;
  /**
   * Sampled frames for animation, first = start, last = final rest. Each frame is
   * `[x0, y0, x1, y1, …]` per ball id in table units (rounded), with -1, -1 once potted.
   */
  readonly frames: readonly (readonly number[])[];
}

/** Exact floor(sqrt(n)) for a non-negative integer n < 2^52. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  // Math.sqrt is only a starting guess; the loops make the result exact on any engine.
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** atan(2^-i) in micro-degrees, i = 0..23. Hard-coded so no float trig runs at game time. */
const ATAN_UDEG = [
  45000000, 26565051, 14036243, 7125016, 3576334, 1789911, 895174, 447614, 223811, 111906, 55953,
  27976, 13988, 6994, 3497, 1749, 874, 437, 219, 109, 55, 27, 14, 7,
];
/** CORDIC gain correction, 0.607252935… × 2^20. */
const CORDIC_K = 636751;
/** Fixed-point scale of `direction` results. */
export const DIR_ONE = 1 << 20;

/**
 * Unit direction for an angle in millidegrees (0 = +x, 90000 = +y, i.e. down on screen),
 * as integers scaled by `DIR_ONE`. Integer CORDIC, so identical everywhere.
 */
export function direction(millideg: number): { dx: number; dy: number } {
  let a = (((millideg % 360000) + 360000) % 360000) * 1000; // micro-degrees in [0, 360e6)
  let flip = 1;
  if (a > 270000000) a -= 360000000;
  else if (a > 90000000) {
    a -= 180000000;
    flip = -1;
  }
  let x = CORDIC_K;
  let y = 0;
  let z = a;
  for (let i = 0; i < ATAN_UDEG.length; i++) {
    const t = ATAN_UDEG[i] as number;
    const xs = x >> i;
    const ys = y >> i;
    if (z >= 0) {
      x -= ys;
      y += xs;
      z -= t;
    } else {
      x += ys;
      y -= xs;
      z += t;
    }
  }
  return { dx: flip * x, dy: flip * y };
}

/** Angle in millidegrees (0..359999) of the vector (dx, dy). Integer CORDIC vectoring. */
export function angleTo(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  // Scale into a range where shifts keep precision but stay within 32 bits.
  let x = Math.trunc(dx);
  let y = Math.trunc(dy);
  while (Math.abs(x) > 1 << 24 || Math.abs(y) > 1 << 24) {
    x = Math.trunc(x / 2);
    y = Math.trunc(y / 2);
  }
  while (Math.abs(x) < 1 << 20 && Math.abs(y) < 1 << 20) {
    x *= 2;
    y *= 2;
  }
  let base = 0;
  if (x < 0) {
    // Rotate by 180° so the vector is in the right half-plane.
    x = -x;
    y = -y;
    base = 180000000;
  }
  let z = 0;
  for (let i = 0; i < ATAN_UDEG.length; i++) {
    const t = ATAN_UDEG[i] as number;
    const xs = x >> i;
    const ys = y >> i;
    if (y > 0) {
      x += ys;
      y -= xs;
      z += t;
    } else {
      x -= ys;
      y += xs;
      z -= t;
    }
  }
  const udeg = (((base + z) % 360000000) + 360000000) % 360000000;
  return Math.round(udeg / 1000) % 360000;
}

interface Body {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  on: boolean;
}

const R = BALL_R * SUB;
const MIN_D2 = 4 * R * R;
/** Cushions keep 7/8 of the normal speed. */
const REST_NUM = 7;
const REST_DEN = 8;
/** Rolling friction: lose speed/FRIC_DIV + ROLL subunits per step. */
const FRIC_DIV = 400;
const ROLL = 4;
/** Below this speed (subunits/step) a ball stops. */
const STOP_SPEED = 16;

function frameOf(bodies: readonly Body[]): number[] {
  const out: number[] = [];
  for (const b of bodies) {
    if (b.on) out.push(Math.round(b.x / SUB), Math.round(b.y / SUB));
    else out.push(-1, -1);
  }
  return out;
}

function inPocket(b: Body): boolean {
  for (const p of POCKETS) {
    const dx = b.x - p.x * SUB;
    const dy = b.y - p.y * SUB;
    const r = p.r * SUB;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/**
 * Strike the cue ball (id 0) at `angle` millidegrees with `power` 1–100 and simulate until every
 * ball rests (or `MAX_STEPS`). Pure: `balls` is not modified.
 */
export function simulate(balls: readonly Ball[], angle: number, power: number): SimResult {
  const bodies: Body[] = balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, on: b.on }));
  const cue = bodies.find((b) => b.id === 0 && b.on);
  if (cue) {
    const { dx, dy } = direction(angle);
    const speed = Math.trunc((Math.max(1, Math.min(100, power)) * MAX_SPEED) / 100);
    cue.vx = Math.trunc((speed * dx) / DIR_ONE);
    cue.vy = Math.trunc((speed * dy) / DIR_ONE);
  }

  const potted: number[] = [];
  let firstContact: number | null = null;
  const raw: number[][] = [frameOf(bodies)];
  let steps = 0;

  const moving = (b: Body) => b.on && (b.vx !== 0 || b.vy !== 0);

  while (steps < MAX_STEPS && bodies.some(moving)) {
    steps++;
    for (const b of bodies) {
      if (moving(b)) {
        b.x += b.vx;
        b.y += b.vy;
      }
    }

    // Ball–ball: equal-mass elastic collision along the line of centres, then separate.
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i] as Body;
      if (!a.on) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j] as Body;
        if (!b.on || (!moving(a) && !moving(b))) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 >= MIN_D2) continue;
        if (d2 === 0) {
          dx = 1;
          dy = 0;
          d2 = 1;
        }
        if (firstContact === null) {
          if (a.id === 0) firstContact = b.id;
          else if (b.id === 0) firstContact = a.id;
        }
        const rel = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;
        if (rel > 0) {
          const jx = Math.trunc((rel * dx) / d2);
          const jy = Math.trunc((rel * dy) / d2);
          a.vx -= jx;
          a.vy -= jy;
          b.vx += jx;
          b.vy += jy;
        }
        const dist = isqrt(d2);
        const overlap = 2 * R - dist;
        if (overlap > 0) {
          const shift = Math.trunc(overlap / 2) + 1;
          const sx = Math.trunc((dx * shift) / Math.max(1, dist));
          const sy = Math.trunc((dy * shift) / Math.max(1, dist));
          a.x -= sx;
          a.y -= sy;
          b.x += sx;
          b.y += sy;
        }
      }
    }

    for (const b of bodies) {
      if (!b.on) continue;
      if (inPocket(b)) {
        b.on = false;
        b.vx = 0;
        b.vy = 0;
        potted.push(b.id);
        continue;
      }
      // Cushions: reflect position and velocity, losing some speed.
      if (b.x < R) {
        b.x = 2 * R - b.x;
        b.vx = Math.trunc((Math.abs(b.vx) * REST_NUM) / REST_DEN);
      } else if (b.x > TABLE_W * SUB - R) {
        b.x = 2 * (TABLE_W * SUB - R) - b.x;
        b.vx = -Math.trunc((Math.abs(b.vx) * REST_NUM) / REST_DEN);
      }
      if (b.y < R) {
        b.y = 2 * R - b.y;
        b.vy = Math.trunc((Math.abs(b.vy) * REST_NUM) / REST_DEN);
      } else if (b.y > TABLE_H * SUB - R) {
        b.y = 2 * (TABLE_H * SUB - R) - b.y;
        b.vy = -Math.trunc((Math.abs(b.vy) * REST_NUM) / REST_DEN);
      }
      // Friction.
      if (b.vx !== 0 || b.vy !== 0) {
        const speed = isqrt(b.vx * b.vx + b.vy * b.vy);
        const next = speed - Math.trunc(speed / FRIC_DIV) - ROLL;
        if (speed < STOP_SPEED || next <= 0) {
          b.vx = 0;
          b.vy = 0;
        } else {
          b.vx = Math.trunc((b.vx * next) / speed);
          b.vy = Math.trunc((b.vy * next) / speed);
        }
      }
    }
    raw.push(frameOf(bodies));
  }

  // Downsample frames to at most MAX_FRAMES, always keeping the final one.
  const stride = Math.max(1, Math.ceil((raw.length - 1) / (MAX_FRAMES - 1)));
  const frames: number[][] = [];
  for (let i = 0; i < raw.length; i += stride) frames.push(raw[i] as number[]);
  const last = raw[raw.length - 1] as number[];
  if (frames[frames.length - 1] !== last) frames.push(last);

  return {
    balls: bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, on: b.on })),
    potted,
    firstContact,
    steps,
    stride,
    frames,
  };
}

/** True if a ball centred at (x, y) subunits would overlap any ball on the table. */
export function isFree(balls: readonly Ball[], x: number, y: number, ignoreId = -1): boolean {
  return balls.every((b) => {
    if (!b.on || b.id === ignoreId) return true;
    const dx = b.x - x;
    const dy = b.y - y;
    return dx * dx + dy * dy >= MIN_D2;
  });
}
