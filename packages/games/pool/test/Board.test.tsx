import { startSession, submitMove, waitingOn, type GameSession } from '@coinclash/game-sdk';
import { testContext } from '@coinclash/game-sdk/testing';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoolBoard } from '../src/Board.js';
import { pool, type PoolState, type PoolView } from '../src/engine.js';

// jsdom has no PointerEvent; without it fireEvent drops clientX/clientY.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Seed where alice breaks, so she is the one to move. */
function freshSession(): { session: GameSession<PoolState>; shooter: string } {
  const session = startSession(pool, testContext('board-seed'));
  return { session, shooter: waitingOn(pool, session)[0]! };
}

function afterShot(session: GameSession<PoolState>, angle = 0, power = 100) {
  const [p] = waitingOn(pool, session);
  const out = submitMove(pool, session, p!, { angle, power });
  if (!out.ok) throw new Error(out.reason);
  return out.session;
}

const shootButton = () => screen.getByRole('button', { name: 'Shoot' }) as HTMLButtonElement;

describe('PoolBoard', () => {
  it('renders the table, all balls and the controls', () => {
    const { session, shooter } = freshSession();
    const { container } = render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Pool table' })).toBeTruthy();
    expect(container.querySelectorAll('[data-ball]')).toHaveLength(16);
    expect(container.querySelector('.pool__guide')).not.toBeNull();
    expect(screen.getByText(/Break!/)).toBeTruthy();
    expect(screen.getAllByText(/Open table/).length).toBeGreaterThan(0);
  });

  it('sliders + Shoot send an integer { angle, power } intent', () => {
    const { session, shooter } = freshSession();
    const onMove = vi.fn();
    render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={onMove}
      />,
    );
    fireEvent.change(screen.getByLabelText('Aim angle'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Power'), { target: { value: '75' } });
    fireEvent.click(shootButton());
    expect(onMove).toHaveBeenCalledWith({ angle: 90000, power: 75 });
    const move = onMove.mock.calls[0]![0] as { angle: number; power: number };
    expect(Number.isInteger(move.angle) && Number.isInteger(move.power)).toBe(true);
  });

  it('nudge buttons fine-tune the angle by one degree, wrapping around', () => {
    const { session, shooter } = freshSession();
    const onMove = vi.fn();
    render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aim left 1°' }));
    fireEvent.click(shootButton());
    expect(onMove).toHaveBeenLastCalledWith({ angle: 359000, power: 60 });
    fireEvent.click(screen.getByRole('button', { name: 'Aim right 1°' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aim right 1°' }));
    fireEvent.click(shootButton());
    expect(onMove).toHaveBeenLastCalledWith({ angle: 1000, power: 60 });
  });

  it('drag on the felt to aim at your finger, then shoot', () => {
    const { session, shooter } = freshSession();
    const onMove = vi.fn();
    render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={onMove}
      />,
    );
    const svg = screen.getByRole('img', { name: 'Pool table' });
    // Rendered 1:1 with the viewBox (1072 × 572, rail 36), so client = table + 36.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1072, height: 572, right: 1072, bottom: 572 }) as DOMRect;
    // Cue ball on the head spot (250, 250). Drag to the right of it: aim 0°. Dragging only aims.
    fireEvent.pointerDown(svg, { clientX: 386, clientY: 286, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 486, clientY: 286, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 486, clientY: 286, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(shootButton());
    expect(onMove).toHaveBeenCalledWith({ angle: 0, power: 60 });

    // Down-left of the cue ball → 135°. A tap on the cue ball itself doesn't change the aim.
    fireEvent.pointerDown(svg, { clientX: 186, clientY: 386, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 186, clientY: 386, pointerId: 1 });
    fireEvent.pointerDown(svg, { clientX: 286, clientY: 286, pointerId: 1 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    fireEvent.click(shootButton());
    expect(onMove).toHaveBeenLastCalledWith({ angle: 135000, power: 60 });
  });

  it('review mode shows the table without controls or aim', () => {
    const { session, shooter } = freshSession();
    render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={vi.fn()}
        mode="review"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Shoot' })).toBeNull();
    expect(screen.queryByText(/Full table/)).toBeNull();
    expect(document.querySelector('.pool__aim')).toBeNull();
  });

  it('full table: the right-edge power cue shoots on release, and cancels near the top', async () => {
    const { PowerCue } = await import('../src/Board.js');
    const onShoot = vi.fn();
    const onPower = vi.fn();
    const { rerender } = render(<PowerCue ready onPower={onPower} onShoot={onShoot} />);
    const cueEl = screen.getByRole('slider', { name: /Power cue/ });
    cueEl.getBoundingClientRect = () => ({ top: 0, height: 250, bottom: 250 }) as DOMRect;
    fireEvent.pointerDown(cueEl, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(cueEl, { clientY: 110, pointerId: 1 }); // 100 / (250·0.8) = 50%
    expect(onPower).toHaveBeenLastCalledWith(50);
    fireEvent.pointerUp(cueEl, { clientY: 110, pointerId: 1 });
    expect(onShoot).toHaveBeenCalledWith(50);
    fireEvent.pointerDown(cueEl, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(cueEl, { clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(cueEl, { clientY: 12, pointerId: 1 });
    expect(onShoot).toHaveBeenCalledTimes(1); // a tiny pull cancels
    rerender(<PowerCue ready={false} onPower={onPower} onShoot={onShoot} />);
    fireEvent.pointerDown(cueEl, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(cueEl, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(cueEl, { clientY: 200, pointerId: 1 });
    expect(onShoot).toHaveBeenCalledTimes(1); // not your shot
  });

  it('aim guide finds the first ball and the object direction, else the cushion', async () => {
    const { aimGuide } = await import('../src/Board.js');
    const balls = [
      { id: 0, x: 100, y: 100 },
      { id: 3, x: 300, y: 100 },
    ];
    const hit = aimGuide(balls, { x: 100, y: 100 }, 1, 0, 18, 1000, 500);
    expect(hit.hit).toBe(3);
    expect(hit.ghost.x).toBeCloseTo(264);
    expect(hit.object).toEqual({ x: 1, y: 0 });
    const miss = aimGuide(balls, { x: 100, y: 100 }, 0, 1, 18, 1000, 500);
    expect(miss).toMatchObject({ hit: null, object: null });
    expect(miss.ghost.y).toBeCloseTo(482);
  });

  it('ignores drags before the SVG has a size, and when it is not your turn', () => {
    const { session, shooter } = freshSession();
    const onMove = vi.fn();
    const view = pool.viewFor(session.state, shooter);
    const { rerender } = render(<PoolBoard view={view} you={shooter} canMove onMove={onMove} />);
    const svg = screen.getByRole('img', { name: 'Pool table' });
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 10, clientY: 10 });
    rerender(<PoolBoard view={view} you={shooter} canMove={false} onMove={onMove} />);
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 10, clientY: 10 });
    expect(shootButton().disabled).toBe(true);
    fireEvent.click(shootButton());
    expect(onMove).not.toHaveBeenCalled();
  });

  it('replays a new shot frame by frame, then shows the final positions', () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { session, shooter } = freshSession();
    const before = pool.viewFor(session.state, shooter);
    const next = afterShot(session);
    const after: PoolView = pool.viewFor(next.state, shooter);
    const { container, rerender } = render(
      <PoolBoard view={before} you={shooter} canMove onMove={vi.fn()} />,
    );
    rerender(<PoolBoard view={after} you={shooter} canMove onMove={vi.fn()} />);
    expect(shootButton().disabled).toBe(true);
    let guard = 0;
    while (queue.length > 0 && guard++ < 1000) act(() => queue.shift()!(0));
    expect(guard).toBeGreaterThan(2);
    expect(shootButton().disabled).toBe(false);
    expect(container.querySelectorAll('[data-ball]')).toHaveLength(after.balls.length);
    const cue = after.balls.find((b) => b.id === 0)!;
    expect(container.querySelector('[data-ball="0"]')!.getAttribute('transform')).toBe(
      `translate(${cue.x} ${cue.y})`,
    );
  });

  it('skips the replay under prefers-reduced-motion', () => {
    // Only the reduced-motion query matches (not the landscape "full table" query).
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') }));
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { session, shooter } = freshSession();
    const { rerender } = render(
      <PoolBoard
        view={pool.viewFor(session.state, shooter)}
        you={shooter}
        canMove
        onMove={vi.fn()}
      />,
    );
    const next = afterShot(session);
    rerender(
      <PoolBoard view={pool.viewFor(next.state, shooter)} you={shooter} canMove onMove={vi.fn()} />,
    );
    expect(raf).not.toHaveBeenCalled();
    expect(shootButton().disabled).toBe(false);
  });

  it('describes fouls, pots and the end of the game; observers get no controls', () => {
    const { session, shooter } = freshSession();
    const base = pool.viewFor(afterShot(session).state, shooter);
    const shot = base.lastShot!;
    const other = shooter === 'alice' ? 'bob' : 'alice';
    const cases: [PoolView, RegExp][] = [
      [{ ...base, lastShot: { ...shot, foul: 'scratch' } }, /Scratch!/],
      [{ ...base, lastShot: { ...shot, foul: 'no-contact' } }, /missed every ball/],
      [{ ...base, lastShot: { ...shot, foul: 'wrong-ball', potted: [] } }, /wrong ball/],
      [{ ...base, lastShot: { ...shot, foul: null, potted: [0, 3, 11] } }, /Potted 3, 11/],
      [{ ...base, lastShot: { ...shot, foul: null, potted: [] } }, /No balls potted/],
      [{ ...base, winner: shooter, turn: null }, /You sank the 8!/],
      [{ ...base, winner: other, turn: null }, /Game over/],
    ];
    for (const [view, text] of cases) {
      render(<PoolBoard view={view} you={shooter} canMove={false} onMove={vi.fn()} />);
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
    render(<PoolBoard view={base} you={null} canMove={false} onMove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Shoot' })).toBeNull();
  });

  it('shows each group’s sunk balls once groups are assigned', () => {
    const { session, shooter } = freshSession();
    const view = pool.viewFor(session.state, shooter);
    const other = shooter === 'alice' ? 'bob' : 'alice';
    render(
      <PoolBoard
        view={{
          ...view,
          balls: view.balls.filter((b) => b.id !== 2 && b.id !== 12),
          groups: { [shooter]: 'stripes', [other]: 'solids' },
          potted: { [shooter]: [12, 2], [other]: [] },
        }}
        you={shooter}
        canMove={false}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText(/You ·/).textContent).toContain('Stripes');
    expect(screen.getByText(/Them ·/).textContent).toContain('Solids');
    expect(screen.getByRole('img', { name: 'Ball 12' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ball 2' })).toBeTruthy();
  });
});
