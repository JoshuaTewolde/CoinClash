import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../src/App';

it('renders the token preview with a test-sats amount', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CoinClash');
  expect(screen.getByText('10,000 test sats')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'New challenge' })).toBeTruthy();
});
