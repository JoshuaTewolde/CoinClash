import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cue,
  cueOnce,
  feedbackEnabled,
  primeFeedback,
  setFeedbackEnabled,
} from '../src/lib/feedback';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function fakeAudio() {
  const started: number[] = [];
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  class FakeCtx {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume = vi.fn();
    createOscillator() {
      const o = {
        type: '',
        frequency: { value: 0 },
        connect: (g: unknown) => g,
        start: () => started.push(o.frequency.value),
        stop: vi.fn(),
      };
      return o;
    }
    createGain() {
      return { gain: param, connect: vi.fn() };
    }
  }
  vi.stubGlobal('AudioContext', FakeCtx);
  return started;
}

describe('haptics and sound', () => {
  it('is on by default and can be turned off', () => {
    expect(feedbackEnabled()).toBe(true);
    setFeedbackEnabled(false);
    expect(feedbackEnabled()).toBe(false);
    setFeedbackEnabled(true);
    expect(feedbackEnabled()).toBe(true);
  });

  it('vibrates and plays notes per cue, and stays quiet when off', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const started = fakeAudio();
    primeFeedback();
    window.dispatchEvent(new Event('pointerdown'));
    cue('win');
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40, 60, 140]);
    expect(started).toEqual([523, 659, 784, 1047]);
    setFeedbackEnabled(false);
    cue('turn');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('cueOnce fires once per key', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    cueOnce('result:m1', 'lose');
    cueOnce('result:m1', 'lose');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
