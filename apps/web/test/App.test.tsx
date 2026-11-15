import type { PublicConfig } from '@coinclash/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { Store } from '../src/lib/store';

afterEach(cleanup);

const config: PublicConfig = {
  network: 'regtest',
  networks: ['regtest'],
  stakeMin: 100,
  stakeMax: 100_000,
  games: [{ id: 'tictactoe', name: 'Tic-tac-toe', turnModel: 'alternating' }],
  welcomeBonusSats: 10_000,
};

/** A store already in a given phase, without network calls. */
function storeWith(patch: Record<string, unknown>): Store {
  const store = new Store();
  const s = store as unknown as { snap: Record<string, unknown> };
  s.snap = { ...s.snap, config, ...patch };
  return store;
}

describe('App shell', () => {
  it('shows onboarding with the two-button flow when signed out', () => {
    render(<App store={storeWith({ phase: 'signedOut' })} />);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeTruthy();
  });

  it('validates the nickname before creating an account', () => {
    render(<App store={storeWith({ phase: 'signedOut' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 2/);
  });

  it('renders Home with plain sats, the network picker and "Coming soon" for real money', () => {
    render(
      <App
        store={storeWith({ phase: 'ready', user: { id: 'u', nickname: 'Uma' }, balance: 10_000 })}
      />,
    );
    expect(screen.getByText('10,000 sats')).toBeTruthy();
    expect(screen.getByRole('link', { name: /New challenge/ })).toBeTruthy();
    const badge = screen.getByRole('button', { name: /TEST SATS/ });
    fireEvent.click(badge);
    const real = screen.getByRole('menuitemradio', { name: /Real money/ }) as HTMLButtonElement;
    expect(real.disabled).toBe(true);
    expect(real.textContent).toMatch(/Coming soon/);
    expect(
      screen.getByRole('menuitemradio', { name: /Test sats/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows head-to-head record and net sats on friend tiles', () => {
    const friend = (id: string, wins: number, losses: number, netSats: number) => ({
      id,
      nickname: id,
      streakDays: 0,
      gamesPlayed: wins + losses,
      lastPlayedAt: 0,
      record: { wins, losses, draws: 0 },
      netSats,
      byGame: {},
    });
    render(
      <App
        store={storeWith({
          phase: 'ready',
          user: { id: 'u', nickname: 'Uma' },
          balance: 0,
          friends: [friend('Maya', 3, 2, 450), friend('Dev', 0, 1, -200), friend('Ann', 1, 1, 0)],
        })}
      />,
    );
    expect(screen.getByText('You 3–2')).toBeTruthy();
    expect(screen.getByText('+450 sats')).toBeTruthy();
    expect(screen.getByText('−200 sats')).toBeTruthy();
    expect(screen.getByText('Even')).toBeTruthy();
  });

  it('shows a retry on connection errors', () => {
    render(<App store={storeWith({ phase: 'error', error: 'Offline' })} />);
    expect(screen.getByRole('alert').textContent).toBe('Offline');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('network warning', () => {
  it('shows a dismissible banner when a payment server is unreachable', () => {
    render(<App store={storeWith({ phase: 'signedOut', networkBlocked: true })} />);
    expect(screen.getByText(/blocking a payment server/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/blocking a payment server/)).toBeNull();
  });
});
