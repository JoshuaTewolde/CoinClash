import type { Network } from './network.js';

const satsFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const SATS_PER_BTC = 100_000_000;

/** Format a whole-sat amount with thousands separators: 5000 -> "5,000". */
export function formatSatsNumber(sats: number): string {
  if (!Number.isFinite(sats)) throw new RangeError(`Invalid sats amount: ${sats}`);
  return satsFormatter.format(Math.trunc(sats));
}

/** Convert sats to USD given a BTC/USD rate. */
export function satsToUsd(sats: number, btcUsdRate: number): number {
  return (sats / SATS_PER_BTC) * btcUsdRate;
}

export interface FormattedAmount {
  /** Primary label, e.g. "5,000 sats" or "5,000 test sats" */
  sats: string;
  /** Secondary label, e.g. "≈ $4.87"; null on regtest/mock or when no rate is known */
  fiat: string | null;
}

/**
 * Sats are the primary unit; dollars are shown smaller, in parentheses, only on mainnet.
 * On regtest and mock, amounts are labelled "test sats" and the dollar value is hidden.
 */
export function formatAmount(
  sats: number,
  network: Network,
  btcUsdRate?: number | null,
): FormattedAmount {
  const isTest = network !== 'mainnet';
  const unit = isTest ? 'test sats' : sats === 1 ? 'sat' : 'sats';
  const satsLabel = `${formatSatsNumber(sats)} ${unit}`;
  const fiat =
    !isTest && btcUsdRate && btcUsdRate > 0
      ? `≈ ${usdFormatter.format(satsToUsd(sats, btcUsdRate))}`
      : null;
  return { sats: satsLabel, fiat };
}

/** One-line form: "5,000 sats (≈ $4.87)". */
export function formatAmountInline(
  sats: number,
  network: Network,
  btcUsdRate?: number | null,
): string {
  const { sats: s, fiat } = formatAmount(sats, network, btcUsdRate);
  return fiat ? `${s} (${fiat})` : s;
}
