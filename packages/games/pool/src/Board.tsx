/**
 * Pool board (web only). Pure presentation: renders `PoolView`, replays the last shot's frames on
 * every phone, and sends `{ angle, power }` intents. The server runs the physics and validates
 * every shot.
 *
 * - Aim: drag on the felt and the cue points at your finger. A ghost ball shows where the cue
 *   ball will first touch an object ball, and which way that ball will go.
 * - Power: portrait uses the power slider and Shoot. Full table (landscape) uses a cue on the
 *   right edge: pull it down to set power, release to shoot. A fine-aim strip sits on the left.
 * - Your group's balls pulse twice at the start of each of your turns (tap your group to replay).
 * - `mode="review"` (result screen): no controls; the game-ending shot replays.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { groupOf, type Group, type PoolMove, type PoolView } from './engine.js';
import './board.css';

/** Rail width around the playfield, in table units. */
const RAIL = 36;

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

/** A phone turned sideways (short landscape viewport). */
const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 560px)';

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

const groupIds = (g: Group) => [1, 2, 3, 4, 5, 6, 7].map((n) => (g === 'solids' ? n : n + 8));

/**
 * Aim guide: the first object ball the cue ball would touch travelling along (ux, uy), the
 * cue ball's centre at contact (ghost ball), and the object ball's departure direction (along
 * the line of centres, as in an equal-mass collision). Falls back to the cushion.
 */
export function aimGuide(
  positions: Positions,
  cue: { x: number; y: number },
  ux: number,
  uy: number,
  R: number,
  W: number,
  H: number,
) {
  let best: { t: number; id: number; bx: number; by: number } | null = null;
  for (const b of positions) {
    if (b.id === 0) continue;
    // Solve |cue + t·u − b| = 2R for the smallest t > 0.
    const fx = cue.x - b.x;
    const fy = cue.y - b.y;
    const bq = fx * ux + fy * uy;
    const c = fx * fx + fy * fy - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && (!best || t < best.t)) best = { t, id: b.id, bx: b.x, by: b.y };
  }
  if (best) {
    const gx = cue.x + ux * best.t;
    const gy = cue.y + uy * best.t;
    const ox = best.bx - gx;
    const oy = best.by - gy;
    const len = Math.hypot(ox, oy) || 1;
    return { hit: best.id, ghost: { x: gx, y: gy }, object: { x: ox / len, y: oy / len } };
  }
  // No ball in the way: run to the cushion (playfield inset by the ball radius).
  const ts = [
    ux > 0 ? (W - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity,
    uy > 0 ? (H - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity,
  ];
  const t = Math.max(0, Math.min(...ts));
  return { hit: null, ghost: { x: cue.x + ux * t, y: cue.y + uy * t }, object: null };
}

export function PoolBoard({
  view,
  you,
  canMove,
  onMove,
  mode = 'play',
}: BoardProps<PoolView, PoolMove>) {
  const review = mode === 'review';
  const uid = useId().replace(/:/g, '');
  const clip = `pool-clip-${uid}`;
  const { width: W, height: H, ballRadius: R, pockets } = view.table;
  const svgRef = useRef<SVGSVGElement>(null);
  const [angle, setAngle] = useState(0); // millidegrees
  const [power, setPower] = useState(60);
  const [aiming, setAiming] = useState(false);
  const [frame, setFrame] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [pulse, setPulse] = useState(0);
  // In review mode the game-ending shot replays once; in play, only shots made after we arrive.
  const seenShot = useRef(review ? -1 : (view.lastShot?.shot ?? 0));

  // Replay a new shot's frames, one per animation frame. Keyed on the shot NUMBER: the shooter
  // gets the same shot twice (move reply + broadcast), which must not restart or cancel it.
  const shot = view.lastShot;
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const shotNo = shot?.shot ?? 0;
  useEffect(() => {
    const s = shotRef.current;
    if (!s || s.shot === seenShot.current) return;
    seenShot.current = s.shot;
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') return;
    let i = 0;
    let raf = 0;
    const tick = () => {
      i++;
      if (i >= s.frames.length) {
        setFrame(null);
        return;
      }
      setFrame(i);
      raf = window.requestAnimationFrame(tick);
    };
    setFrame(0);
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [shotNo]);

  const animating = frame !== null && shot !== null;
  const positions: Positions = animating
    ? framePositions(shot.frames[frame] ?? [])
    : view.balls.map((b) => ({ id: b.id, x: b.x, y: b.y }));
  const cue = positions.find((b) => b.id === 0);
  const ready = !review && canMove && !animating && cue !== undefined;

  // Your turn begins: pulse your group's balls twice.
  useEffect(() => {
    if (ready) setPulse((p) => p + 1);
  }, [ready]);

  // Phone turned sideways → full table automatically; back to portrait → normal layout.
  useEffect(() => {
    if (review || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(LANDSCAPE_PHONE);
    const sync = () => setFull(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, [review]);

  const enterFull = async () => {
    setFull(true);
    try {
      await document.documentElement.requestFullscreen?.();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape');
    } catch {
      /* not supported (e.g. iOS): the CSS layout still fills the screen */
    }
  };
  const exitFull = async () => {
    setFull(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  };

  const shoot = (p = power) => {
    if (ready) onMove({ angle, power: Math.max(1, Math.min(100, Math.round(p))) });
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

  /** Point the cue at the finger. */
  const aimAt = (e: PointerEvent<SVGSVGElement>) => {
    const p = toTable(e);
    if (!p || !cue) return;
    const dx = p.x - cue.x;
    const dy = p.y - cue.y;
    if (Math.hypot(dx, dy) < R) return;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    setAngle(((Math.round(deg * 1000) % 360000) + 360000) % 360000);
  };

  const rad = (angle / 1000) * (Math.PI / 180);
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const guide = cue ? aimGuide(positions, cue, ux, uy, R, W, H) : null;
  const stickGap = R + 8 + power * 0.9; // the cue draws back as power rises

  const me = you ?? '';
  const ids = Object.keys(view.groups);
  const them = ids.find((p) => p !== me) ?? '';
  const myGroup = view.groups[me];
  const theirGroup = view.groups[them];
  const onTable = new Set(view.balls.map((b) => b.id));
  /** A group's balls that are off the table; on an open table, what this player potted. */
  const sunk = (g: Group | null | undefined, own: readonly number[] = []) =>
    g ? groupIds(g).filter((id) => !onTable.has(id)) : own;
  const left = (g: Group | null | undefined) =>
    g ? groupIds(g).filter((id) => onTable.has(id)) : [];
  const pulsing = new Set(myGroup && pulse > 0 ? left(myGroup) : []);

  const status = (() => {
    if (view.winner !== null) return view.winner === you ? 'You sank the 8!' : 'Game over';
    if (animating) return 'Rolling…';
    if (!shot) return ready ? 'Break! Drag on the table to aim.' : 'Waiting for the break…';
    if (shot.foul) return FOUL_TEXT[shot.foul];
    const objects = shot.potted.filter((id) => id !== 0);
    if (objects.length > 0) return `Potted ${objects.join(', ')}.`;
    return 'No balls potted.';
  })();
  const turnText = view.winner !== null || animating ? '' : canMove ? 'Your shot' : 'Their shot';

  const table = (
    <svg
      ref={svgRef}
      className={`pool__table${ready ? ' pool__table--ready' : ''}`}
      viewBox={`${-RAIL} ${-RAIL} ${W + 2 * RAIL} ${H + 2 * RAIL}`}
      role="img"
      aria-label="Pool table"
      onPointerDown={(e) => {
        if (!ready) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setAiming(true);
        aimAt(e);
      }}
      onPointerMove={(e) => aiming && aimAt(e)}
      onPointerUp={() => setAiming(false)}
      onPointerCancel={() => setAiming(false)}
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

      {ready && cue && guide && (
        <g className="pool__aim" pointerEvents="none">
          <line
            x1={cue.x}
            y1={cue.y}
            x2={guide.ghost.x}
            y2={guide.ghost.y}
            className="pool__guide"
          />
          <circle cx={guide.ghost.x} cy={guide.ghost.y} r={R} className="pool__ghost" />
          {guide.object && guide.hit !== null && (
            <line
              x1={guide.ghost.x + guide.object.x * 2 * R}
              y1={guide.ghost.y + guide.object.y * 2 * R}
              x2={guide.ghost.x + guide.object.x * 6 * R}
              y2={guide.ghost.y + guide.object.y * 6 * R}
              className="pool__guide pool__guide--object"
            />
          )}
          <line
            x1={cue.x - ux * stickGap}
            y1={cue.y - uy * stickGap}
            x2={cue.x - ux * (stickGap + 260)}
            y2={cue.y - uy * (stickGap + 260)}
            className="pool__stick"
          />
        </g>
      )}

      {positions.map((b) => (
        <g key={b.id} transform={`translate(${b.x} ${b.y})`} data-ball={b.id}>
          {pulsing.has(b.id) && !animating && (
            <circle key={pulse} r={R * 1.25} className="pool__pulse" />
          )}
          <BallGlyph id={b.id} r={R} clip={clip} />
        </g>
      ))}
    </svg>
  );

  const groupButton = (
    <button
      type="button"
      className="pool__group"
      onClick={() => setPulse((p) => p + 1)}
      aria-label={`You: ${groupLabel(myGroup)}. Show my balls`}
    >
      You: <strong>{groupLabel(myGroup)}</strong>
    </button>
  );

  if (full && !review) {
    return (
      <div className="pool pool--full" data-shots={view.shots}>
        <div className="pool__topbar">
          <button
            type="button"
            className="pool__btn pool__exit"
            aria-label="Exit full table"
            onClick={() => void exitFull()}
          >
            ✕
          </button>
          <div className="pool__who">
            {groupButton}
            <span className="pool__chips">
              {left(myGroup).map((id) => (
                <BallChip key={id} id={id} />
              ))}
            </span>
          </div>
          <span className={`pool__turn${ready ? ' pool__turn--mine' : ''}`} aria-live="polite">
            {turnText ? `${turnText} · ${status}` : status}
          </span>
          <div className="pool__who pool__who--them">
            <span className="pool__chips">
              {left(theirGroup).map((id) => (
                <BallChip key={id} id={id} />
              ))}
            </span>
            <span>
              Them: <strong>{groupLabel(theirGroup)}</strong>
            </span>
          </div>
        </div>
        <div className="pool__arena">
          <FineAim ready={ready} onNudge={(d) => setAngle((a) => (a + d + 360000) % 360000)} />
          <div className="pool__table-wrap">{table}</div>
          <PowerCue ready={ready} onPower={setPower} onShoot={(p) => shoot(p)} />
        </div>
      </div>
    );
  }

  return (
    <div className="pool" data-shots={view.shots}>
      <p className="pool__status" aria-live="polite">
        {groupButton}
        <span>{status}</span>
      </p>

      {table}

      <div className="pool__racks">
        <PottedRow label="You" group={myGroup} potted={sunk(myGroup, view.potted[me])} />
        <PottedRow label="Them" group={theirGroup} potted={sunk(theirGroup, view.potted[them])} />
      </div>

      {!review && you !== null && view.winner === null && (
        <>
          <button
            type="button"
            className="pool__btn pool__fullbtn"
            onClick={() => void enterFull()}
          >
            ⟲ Full table (turn your phone)
          </button>
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
              onClick={() => shoot()}
            >
              Shoot
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Right-edge power cue: pull the cue down to set power, release to shoot. Releasing near the
 * top cancels. Slides away while it isn't your shot.
 */
export function PowerCue({
  ready,
  onPower,
  onShoot,
}: {
  ready: boolean;
  onPower: (p: number) => void;
  onShoot: (p: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0); // 0..100
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);

  const at = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    const p = ((clientY - start.current) / (rect.height * 0.8)) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  };

  return (
    <div
      ref={trackRef}
      className={`pool__power${ready ? ' pool__power--ready' : ''}`}
      role="slider"
      aria-label="Power cue: pull down, release to shoot"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pull}
      aria-disabled={!ready}
      tabIndex={ready ? 0 : -1}
      onPointerDown={(e) => {
        if (!ready) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = e.clientY;
        setDragging(true);
        setPull(0);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const p = at(e.clientY);
        setPull(p);
        onPower(Math.max(1, p));
      }}
      onPointerUp={() => {
        if (!dragging) return;
        setDragging(false);
        const p = pull;
        setPull(0);
        if (p >= 4) onShoot(p);
      }}
      onPointerCancel={() => {
        setDragging(false);
        setPull(0);
      }}
      onKeyDown={(e) => {
        if (!ready) return;
        if (e.key === 'ArrowDown') setPull((p) => Math.min(100, p + 5));
        if (e.key === 'ArrowUp') setPull((p) => Math.max(0, p - 5));
        if (e.key === 'Enter' && pull >= 4) {
          onShoot(pull);
          setPull(0);
        }
      }}
    >
      <div className="pool__power-fill" style={{ height: `${pull}%` }} />
      <div className="pool__power-cue" style={{ transform: `translateY(${pull * 0.8}%)` }}>
        <span className="pool__power-tip" />
      </div>
      <span className="pool__power-label">{dragging ? pull : 'Pull'}</span>
    </div>
  );
}

/** Left-edge fine-aim strip: drag up/down to rotate the aim in small steps. */
function FineAim({ ready, onNudge }: { ready: boolean; onNudge: (millideg: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`pool__fine${ready ? ' pool__fine--ready' : ''}`}
      role="slider"
      aria-label="Fine aim: drag up or down"
      aria-valuetext="fine aim"
      aria-disabled={!ready}
      tabIndex={ready ? 0 : -1}
      onPointerDown={(e) => {
        if (!ready) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        last.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const dy = e.clientY - last.current;
        last.current = e.clientY;
        onNudge(Math.round(dy * 100)); // 0.1° per pixel
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onNudge(-200);
        if (e.key === 'ArrowDown') onNudge(200);
      }}
    >
      <span className="pool__fine-ridges" aria-hidden="true" />
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
