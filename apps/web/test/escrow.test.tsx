import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { StoreProvider } from '../src/lib/StoreContext';
import { Store } from '../src/lib/store';
import { Escrow } from '../src/screens/Escrow';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const page = () =>
  render(
    <StoreProvider store={new Store()}>
      <MemoryRouter>
        <Escrow />
      </MemoryRouter>
    </StoreProvider>,
  );

it('shows held vs owed, covered, and recent payouts', async () => {
  vi.spyOn(api, 'escrow').mockResolvedValue({
    balance: 12_000,
    owed: 8_000,
    liveMatches: 2,
    recent: [{ at: 1, gameId: 'connect4', kind: 'payout', amount: 4_000 }],
    at: 2,
  });
  page();
  expect(await screen.findByText('✓ Fully covered')).toBeTruthy();
  expect(screen.getByText('2 live matches')).toBeTruthy();
  expect(screen.getByText(/Winner paid · Connect 4/)).toBeTruthy();
});

it('flags a shortfall and shows errors', async () => {
  vi.spyOn(api, 'escrow').mockResolvedValueOnce({
    balance: 1,
    owed: 8_000,
    liveMatches: 1,
    recent: [],
    at: 2,
  });
  page();
  expect(await screen.findByText(/Not fully covered/)).toBeTruthy();
  expect(screen.getByText('No payouts yet.')).toBeTruthy();
  cleanup();
  vi.spyOn(api, 'escrow').mockRejectedValue(new Error('Escrow wallet unavailable'));
  page();
  expect(await screen.findByText('Escrow wallet unavailable')).toBeTruthy();
});
