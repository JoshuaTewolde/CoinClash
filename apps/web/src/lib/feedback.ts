/**
 * Haptics and sound cues (ADR 0019): a buzz and a short tone when it becomes your turn, and when
 * you win or lose. On by default; Settings can turn them off (per device).
 */
export type Cue = 'turn' | 'win' | 'lose';

const KEY = 'cc:feedback';

export function feedbackEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setFeedbackEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: stays on for this session */
  }
}

const VIBRATE: Record<Cue, number | number[]> = {
  turn: 35,
  win: [40, 60, 40, 60, 140],
  lose: [180],
};

/** Notes per cue: [frequency Hz, start s, length s]. */
const NOTES: Record<Cue, [number, number, number][]> = {
  turn: [[880, 0, 0.09]],
  win: [
    [523, 0, 0.1],
    [659, 0.1, 0.1],
    [784, 0.2, 0.1],
    [1047, 0.3, 0.22],
  ],
  lose: [
    [392, 0, 0.16],
    [262, 0.16, 0.3],
  ],
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Unlock audio on the first tap (browsers block sound until the user interacts). */
export function primeFeedback(): void {
  if (typeof window === 'undefined') return;
  const once = () => {
    audio();
    window.removeEventListener('pointerdown', once);
  };
  window.addEventListener('pointerdown', once);
}

export function cue(kind: Cue): void {
  if (!feedbackEnabled()) return;
  try {
    navigator.vibrate?.(VIBRATE[kind]);
  } catch {
    /* not supported */
  }
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t0 = ac.currentTime;
  for (const [freq, start, len] of NOTES[kind]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + len + 0.02);
  }
}

const cued = new Set<string>();

/** Cue once per key (e.g. a match result), so revisiting a screen stays quiet. */
export function cueOnce(key: string, kind: Cue): void {
  if (cued.has(key)) return;
  cued.add(key);
  cue(kind);
}
