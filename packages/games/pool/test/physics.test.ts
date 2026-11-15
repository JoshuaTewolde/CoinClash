import { describe, expect, it } from 'vitest';
import { rack } from '../src/engine.js';
import {
  angleTo,
  BALL_R,
  direction,
  DIR_ONE,
  isFree,
  isqrt,
  MAX_FRAMES,
  MAX_STEPS,
  simulate,
  SUB,
  TABLE_H,
  TABLE_W,
  type Ball,
} from '../src/physics.js';

const ball = (id: number, x: number, y: number, on = true): Ball => ({
  id,
  x: x * SUB,
  y: y * SUB,
  on,
});

function minGap(balls: readonly Ball[]): number {
  let min = Infinity;
  const on = balls.filter((b) => b.on);
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++) {
      const a = on[i]!;
      const b = on[j]!;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) / SUB);
    }
  return min;
}

describe('pool physics: integer math', () => {
  it('isqrt is exact floor(sqrt(n))', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, 2 ** 31, 2 ** 40 + 7, 1e12, -5]) {
      const r = isqrt(n);
      if (n <= 0) expect(r).toBe(0);
      else {
        expect(r * r).toBeLessThanOrEqual(n);
        expect((r + 1) * (r + 1)).toBeGreaterThan(n);
      }
    }
    for (let k = 1; k < 2000; k++) {
      expect(isqrt(k * k)).toBe(k);
      expect(isqrt(k * k - 1)).toBe(k - 1);
    }
  });

  it('direction is a unit vector close to cos/sin, for every quadrant', () => {
    for (let a = 0; a < 360000; a += 7919) {
      const { dx, dy } = direction(a);
      const rad = ((a / 1000) * Math.PI) / 180;
      expect(Math.abs(dx / DIR_ONE - Math.cos(rad))).toBeLessThan(1e-4);
      expect(Math.abs(dy / DIR_ONE - Math.sin(rad))).toBeLessThan(1e-4);
    }
    expect(direction(360000)).toEqual(direction(0));
    expect(direction(-90000)).toEqual(direction(270000));
  });

  it('angleTo inverts direction', () => {
    expect(angleTo(0, 0)).toBe(0);
    expect(angleTo(5, 0)).toBe(0);
    expect(angleTo(0, 5)).toBe(90000);
    expect(angleTo(-5, 0)).toBe(180000);
    expect(angleTo(0, -5)).toBe(270000);
    expect(angleTo(1e9, 1e9)).toBe(45000);
    for (let a = 0; a < 360000; a += 4999) {
      const { dx, dy } = direction(a);
      const back = angleTo(dx, dy);
      const diff = Math.min(Math.abs(back - a), 360000 - Math.abs(back - a));
      expect(diff).toBeLessThanOrEqual(2);
    }
  });
});

describe('pool physics: simulation', () => {
  it('is deterministic: the same shot gives byte-identical results', () => {
    const balls = rack('det');
    const a = simulate(balls, 1234, 100);
    const b = simulate(balls, 1234, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the input', () => {
    const balls = Object.freeze(rack('frozen').map((b) => Object.freeze(b)));
    expect(() => simulate(balls, 0, 100)).not.toThrow();
  });

  it('a ball at rest stays put when nothing hits it', () => {
    const balls = [ball(0, 200, 250), ball(5, 800, 100)];
    const r = simulate(balls, 180000, 20);
    expect(r.balls[1]).toEqual(balls[1]);
    expect(r.firstContact).toBeNull();
  });

  it('does nothing without a cue ball on the table', () => {
    const r = simulate([ball(0, 200, 250, false), ball(3, 500, 250)], 0, 100);
    expect(r.steps).toBe(0);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]).toEqual([-1, -1, 500, 250]);
  });

  it('pots a straight shot into the corner and records first contact', () => {
    const r = simulate([ball(0, 800, 300), ball(3, 900, 400)], 45000, 50);
    expect(r.firstContact).toBe(3);
    expect(r.potted).toEqual([3]);
    expect(r.balls.find((b) => b.id === 3)!.on).toBe(false);
    expect(r.frames.at(-1)!.slice(2, 4)).toEqual([-1, -1]);
  });

  it('scratches the cue ball into a side pocket', () => {
    const r = simulate([ball(0, 500, 250)], 270000, 40);
    expect(r.potted).toEqual([0]);
  });

  it('bounces off a cushion, losing speed, and comes back', () => {
    const r = simulate([ball(0, 500, 250)], 0, 100);
    const xs = r.frames.map((f) => f[0]!);
    const maxX = Math.max(...xs);
    expect(maxX).toBeGreaterThanOrEqual(TABLE_W - BALL_R - 30);
    expect(maxX).toBeLessThanOrEqual(TABLE_W - BALL_R);
    expect(xs.at(-1)!).toBeLessThan(maxX - 50);
    expect(new Set(r.frames.map((f) => f[1]))).toEqual(new Set([250]));
    expect(r.potted).toEqual([]);
  });

  it('bounces off all four cushions', () => {
    for (const angle of [0, 90000, 180000, 270000].map((a) => a + 20000)) {
      const r = simulate([ball(0, 500, 250)], angle, 100);
      for (const f of r.frames) {
        if (f[0] === -1) continue;
        expect(f[0]!).toBeGreaterThanOrEqual(BALL_R - 1);
        expect(f[0]!).toBeLessThanOrEqual(TABLE_W - BALL_R + 1);
        expect(f[1]!).toBeGreaterThanOrEqual(BALL_R - 1);
        expect(f[1]!).toBeLessThanOrEqual(TABLE_H - BALL_R + 1);
      }
    }
  });

  it('energy decays: a free-rolling ball slows down every frame and stops', () => {
    const r = simulate([ball(0, 100, 250)], 0, 30);
    const xs = r.frames.map((f) => f[0]!);
    const deltas = xs.slice(1).map((x, i) => x - xs[i]!);
    for (let i = 1; i < deltas.length; i++)
      expect(deltas[i]!).toBeLessThanOrEqual(deltas[i - 1]! + 1);
    expect(deltas.at(-1)!).toBeLessThanOrEqual(1);
    expect(r.steps).toBeLessThan(MAX_STEPS);
  });

  it('breaks terminate, leave no overlapping balls, and cap the frame count', () => {
    for (let i = 0; i < 12; i++) {
      const balls = rack(`break-${i}`);
      const r = simulate(balls, 357000 + i * 500, 100);
      expect(r.steps).toBeGreaterThan(0);
      expect(r.steps).toBeLessThan(MAX_STEPS);
      expect(r.frames.length).toBeLessThanOrEqual(MAX_FRAMES + 1);
      expect(minGap(r.balls)).toBeGreaterThan(2 * BALL_R - 1);
      expect(r.firstContact).not.toBeNull();
      const final = r.frames.at(-1)!;
      for (const b of r.balls) {
        expect(final[b.id * 2]).toBe(b.on ? Math.round(b.x / SUB) : -1);
      }
    }
  });

  it('separates two balls that start on the same spot', () => {
    const r = simulate([ball(0, 500, 250), ball(1, 500, 250)], 0, 10);
    expect(minGap(r.balls)).toBeGreaterThan(2 * BALL_R - 1);
  });

  it('a head-on hit transfers the momentum', () => {
    const r = simulate([ball(0, 300, 250), ball(9, 400, 250)], 0, 30);
    const cue = r.balls[0]!;
    const nine = r.balls[1]!;
    expect(r.firstContact).toBe(9);
    expect(nine.x - 400 * SUB).toBeGreaterThan(cue.x - 300 * SUB);
  });

  it('isFree checks overlap with balls on the table only', () => {
    const balls = [ball(0, 100, 100), ball(1, 200, 100), ball(2, 300, 300, false)];
    expect(isFree(balls, 200 * SUB, 120 * SUB)).toBe(false);
    expect(isFree(balls, 300 * SUB, 300 * SUB)).toBe(true);
    expect(isFree(balls, 100 * SUB, 100 * SUB, 0)).toBe(true);
  });
});
