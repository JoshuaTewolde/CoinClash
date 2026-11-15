import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { resetRate, usdLabel } from '../src/lib/rate';
import { StakeInput } from '../src/screens/StakeInput';

afterEach(() => {
  cleanup();
  resetRate();
  vi.restoreAllMocks();
});

it('shows "sats" and the dollar equivalent, not the limits', async () => {
  vi.spyOn(api, 'rate').mockResolvedValue({ usd: 100_000 });
  render(<StakeInput value={2000} onChange={vi.fn()} min={100} max={100_000} />);
  expect(await screen.findByLabelText('US dollar equivalent')).toHaveProperty(
    'textContent',
    '≈ $2.00',
  );
  expect(screen.getByText('sats')).toBeTruthy();
  expect(screen.queryByText(/100,000/)).toBeNull();
});

it('hides dollars without a rate', async () => {
  vi.spyOn(api, 'rate').mockRejectedValue(new Error('offline'));
  render(<StakeInput value={2000} onChange={vi.fn()} min={100} max={100_000} />);
  await Promise.resolve();
  expect(screen.queryByLabelText('US dollar equivalent')).toBeNull();
});

it('formats tiny and missing amounts', () => {
  expect(usdLabel(1, 100_000)).toBe('≈ < $0.01');
  expect(usdLabel(0, 100_000)).toBe('≈ $0.00');
  expect(usdLabel(500, null)).toBeNull();
});
