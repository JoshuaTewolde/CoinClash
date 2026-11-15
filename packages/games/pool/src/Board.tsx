/**
 * Pool board (web only). Pure presentation: renders `PoolView`, replays the last shot's frames,
 * and sends `{ angle, power }` intents. The server runs the physics and validates every shot.
 *
 * Aim by dragging back from the cue ball (like pulling a slingshot), or with the angle/power
 * sliders and the Shoot button.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { groupOf, type Group, type PoolMove, type PoolView } from './engine.js';
import './board.css';

/** Rail width around the playfield, in table units. */
const RAIL = 36;
/** Drag distance (table units) that maps to full power. */
const FULL_PULL = 260;

const BALL_COLORS = [
  'var(--cc-sunflower)',
  'var(--cc-teal)',
  'var(--cc-tomato)',
  'var(--cc-ink-soft)',
  'var(--cc-sunflower)',
  'var(--cc-teal)',
  'var(--cc-tomato)',
] as const;

function ballColor(id: number): string {
  return BALL_COLORS[(id - 1) % 8] ?? 'var(--cc-white)';
}

const FOUL_TEXT = {
  scratch: 'Scratch! Cue ball back on the spot.',
  'no-contact': 'Foul: missed every ball.',
  'wrong-ball': 'Foul: hit the wrong ball first.',
} as const;

function groupLabel(g: Group | null | undefined): string {
  return g === 'solids' ? 'Solids' : g === 'stripes' ? 'Stripes' : 'Open table';
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** One ball drawn at the origin; position it with a transform. */
function BallGlyph({ id, r, clip }: { id: number; r: number; clip: string }) {
  if (id === 0) return <circle r={r} className="pool__ball pool__ball--cue" />;
  if (id === 8)
    return (
      <g>
        <circle r={r} className="pool__ball pool__ball--eight" />
        <circle r={r * 0.42} className="pool__eight-spot" />
      </g>
    );
  const color = ballColor(id);
  if (groupOf(id) === 'solids') {
    return <circle r={r} className="pool__ball" style={{ fill: color }} />;
  }
  return (
    <g>
      <circle r={r} className="pool__ball-base" />
      <rect
        x={-r}
        y={-r * 0.45}
        width={r * 2}
        height={r * 0.9}
        clipPath={`url(#${clip})`}
        style={{ fill: color }}
      />
      <circle r={r} className="pool__ball pool__ball--outline" />
    </g>
  );
}

function BallChip({ id }: { id: number }) {
  return (
    <svg viewBox="-12 -12 24 24" className="pool__chip" role="img" aria-label={`Ball ${id}`}>
      <defs>
        <clipPath id={`pool-chip-${id}`}>
          <circle r={10} />
        </clipPath>
      </defs>
      <BallGlyph id={id} r={10} clip={`pool-chip-${id}`} />
    </svg>
  );
}

type Positions = readonly { id: number; x: number; y: number }[];

function framePositions(frame: readonly number[]): Positions {
  const out: { id: number; x: number; y: number }[] = [];
  for (let id = 0; id * 2 < frame.length; id++) {
    const x = frame[id * 2] as number;
    const y = frame[id * 2 + 1] as number;
    if (x >= 0) out.push({ id, x, y });
  }
  return out;
}

export function PoolBoard({ view, you, canMove, onMove }: BoardProps<PoolView, PoolMove>) {
  const uid = useId().replace(/:/g, '');
  const clip = `pool-clip-${uid}`;
  const { width: W, height: H, ballRadius: R, pockets } = view.table;
  const svgRef = useRef<SVGSVGElement>(null);
  const [angle, setAngle] = useState(0); // millidegrees
  const [power, setPower] = useState(60);
  const [dragging, setDragging] = useState(false);
  const [frame, setFrame] = useState<number | null>(null);
  const seenShot = useRef(view.lastShot?.shot ?? 0);

  // Replay a new shot's frames, one per animation frame. Reduced motion jumps to the end.
  const shot = view.lastShot;
  useEffect(() => {
    if (!shot || shot.shot === seenShot.current) return;
    seenShot.current = shot.shot;
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') return;
    let i = 0;
    let raf = 0;
    const tick = () => {
      i++;
      if (i >= shot.frames.length) {
        setFrame(null);
        return;
      }
      setFrame(i);
      raf = window.requestAnimationFrame(tick);
    };
    setFrame(0);
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      setFrame(null);
    };
  }, [shot]);

  const animating = frame !== null && shot !== null;
  const positions: Positions = animating
    ? framePositions(shot.frames[frame] ?? [])
    : view.balls.map((b) => ({ id: b.id, x: b.x, y: b.y }));
  const cue = positions.find((b) => b.id === 0);
  const ready = canMove && !animating && cue !== undefined;

  const shoot = () => {
    if (ready) onMove({ angle, power });
  };

  /** Pointer position in table units, or null if the SVG has no size yet. */
  const toTable = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * (W + 2 * RAIL) - RAIL,
      y: ((e.clientY - rect.top) / rect.height) * (H + 2 * RAIL) - RAIL,
    };
  };

  /** Drag back from the cue ball: the shot goes the opposite way, harder the further you pull. */
  const aimFrom = (e: PointerEvent<SVGSVGElement>): PoolMove | null => {
    const p = toTable(e);
    if (!p || !cue) return null;
    const dx = cue.x - p.x;
    const dy = cue.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < R) return null;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const move = {
      angle: ((Math.round(deg * 1000) % 360000) + 360000) % 360000,
      power: Math.max(1, Math.min(100, Math.round((dist / FULL_PULL) * 100))),
    };
    setAngle(move.angle);
    setPower(move.power);
    return move;
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    aimFrom(e);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging) aimFrom(e);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    setDragging(false);
    const move = aimFrom(e);
    if (move && ready) onMove(move);
  };

  const rad = (angle / 1000) * (Math.PI / 180);
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const guide = 80 + power * 4;
  const stick = 30 + power * 1.2;

  const me = you ?? '';
  const ids = Object.keys(view.groups);
  const them = ids.find((p) => p !== me) ?? '';
  const myGroup = view.groups[me];
  const onTable = new Set(view.balls.map((b) => b.id));
  /** A group's balls that are off the table; on an open table, what this player potted. */
  const sunk = (g: Group | null | undefined, own: readonly number[] = []) =>
    g
      ? [1, 2, 3, 4, 5, 6, 7]
          .map((n) => (g === 'solids' ? n : n + 8))
          .filter((id) => !onTable.has(id))
      : own;
  const status = (() => {
    if (view.winner !== null) return view.winner === you ? 'You sank the 8!' : 'Game over';
    if (!shot) return 'Break! Drag back from the cue ball to shoot.';
    if (shot.foul) return FOUL_TEXT[shot.foul];
    const objects = shot.potted.filter((id) => id !== 0);
    if (objects.length > 0) return `Potted ${objects.join(', ')}.`;
    return 'No balls potted.';
  })();

  return (
    <div className="pool" data-shots={view.shots}>
      <p className="pool__status" aria-live="polite">
        <span className="pool__group">
          You: <strong>{groupLabel(myGroup)}</strong>
        </span>
        <span>{status}</span>
      </p>

      <svg
        ref={svgRef}
        className={`pool__table${ready ? ' pool__table--ready' : ''}`}
        viewBox={`${-RAIL} ${-RAIL} ${W + 2 * RAIL} ${H + 2 * RAIL}`}
        role="img"
        aria-label="Pool table"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(false)}
      >
        <defs>
          <clipPath id={clip}>
            <circle r={R} />
          </clipPath>
        </defs>
        <rect
          x={-RAIL}
          y={-RAIL}
          width={W + 2 * RAIL}
          height={H + 2 * RAIL}
          rx={RAIL}
          className="pool__rail"
        />
        <rect x={0} y={0} width={W} height={H} className="pool__felt" />
        {[1, 2, 3, 5, 6, 7].map((i) => (
          <g key={i}>
            <circle cx={(W / 8) * i} cy={-RAIL / 2} r={4} className="pool__diamond" />
            <circle cx={(W / 8) * i} cy={H + RAIL / 2} r={4} className="pool__diamond" />
          </g>
        ))}
        <line x1={W / 4} y1={0} x2={W / 4} y2={H} className="pool__headline" />
        {pockets.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={R * 1.6} className="pool__pocket" />
        ))}

        {ready && cue && (
          <g className="pool__aim" pointerEvents="none">
            <line
              x1={cue.x}
              y1={cue.y}
              x2={cue.x + ux * guide}
              y2={cue.y + uy * guide}
              className="pool__guide"
            />
            <line
              x1={cue.x - ux * (R + 6)}
              y1={cue.y - uy * (R + 6)}
              x2={cue.x - ux * (R + 6 + stick)}
              y2={cue.y - uy * (R + 6 + stick)}
              className="pool__stick"
            />
          </g>
        )}

        {positions.map((b) => (
          <g key={b.id} transform={`translate(${b.x} ${b.y})`} data-ball={b.id}>
            <BallGlyph id={b.id} r={R} clip={clip} />
          </g>
        ))}
      </svg>

      <div className="pool__racks">
        <PottedRow label="You" group={myGroup} potted={sunk(myGroup, view.potted[me])} />
        <PottedRow
          label="Them"
          group={view.groups[them]}
          potted={sunk(view.groups[them], view.potted[them])}
        />
      </div>

      {you !== null && view.winner === null && (
        <div className="pool__controls">
          <label className="pool__field">
            <span>
              Aim <strong>{Math.round(angle / 1000)}°</strong>
            </span>
            <span className="pool__nudge">
              <button
                type="button"
                className="pool__btn"
                aria-label="Aim left 1°"
                disabled={!ready}
                onClick={() => setAngle((a) => (a + 359000) % 360000)}
              >
                ‹
              </button>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                aria-label="Aim angle"
                value={Math.round(angle / 1000) % 360}
                disabled={!ready}
                onChange={(e) => setAngle(Number(e.target.value) * 1000)}
              />
              <button
                type="button"
                className="pool__btn"
                aria-label="Aim right 1°"
                disabled={!ready}
                onClick={() => setAngle((a) => (a + 1000) % 360000)}
              >
                ›
              </button>
            </span>
          </label>
          <label className="pool__field">
            <span>
              Power <strong>{power}</strong>
            </span>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              aria-label="Power"
              value={power}
              disabled={!ready}
              onChange={(e) => setPower(Number(e.target.value))}
            />
          </label>
          <div className="pool__meter" aria-hidden="true">
            <div className="pool__meter-fill" style={{ width: `${power}%` }} />
          </div>
          <button
            type="button"
            className="pool__btn pool__btn--shoot"
            disabled={!ready}
            onClick={shoot}
          >
            Shoot
          </button>
        </div>
      )}
    </div>
  );
}

function PottedRow({
  label,
  group,
  potted,
}: {
  label: string;
  group: Group | null | undefined;
  potted: readonly number[];
}) {
  return (
    <div className="pool__rack">
      <span className="pool__rack-label">
        {label} · {groupLabel(group)}
      </span>
      <span className="pool__chips">
        {potted.length === 0 ? (
          <span className="pool__none">none yet</span>
        ) : (
          potted.map((id) => <BallChip key={id} id={id} />)
        )}
      </span>
    </div>
  );
}

export default PoolBoard;
