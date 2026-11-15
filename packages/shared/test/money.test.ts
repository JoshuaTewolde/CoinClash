import { describe, expect, it } from 'vitest';
import { formatAmount, formatAmountInline, formatSatsNumber, satsToUsd } from '../src/index.js';

describe('money formatting', () => {
  it('formats sats with separators', () => {
    expect(formatSatsNumber(5000)).toBe('5,000');
    expect(formatSatsNumber(100_000)).toBe('100,000');
    expect(formatSatsNumber(0)).toBe('0');
  });

  it('rejects non-finite amounts', () => {
    expect(() => formatSatsNumber(Number.NaN)).toThrow(RangeError);
  });

  it('converts sats to usd', () => {
    expect(satsToUsd(100_000_000, 97_400)).toBe(97_400);
  });

  it('shows dollars on mainnet when a rate is known', () => {
    expect(formatAmountInline(5000, 'mainnet', 97_400)).toBe('5,000 sats (≈ $4.87)');
    expect(formatAmount(1, 'mainnet').sats).toBe('1 sat');
  });

  it('hides dollars on mainnet without a rate', () => {
    expect(formatAmount(5000, 'mainnet', null)).toEqual({ sats: '5,000 sats', fiat: null });
  });

  it('labels test sats and hides dollars on regtest and mock', () => {
    expect(formatAmountInline(5000, 'regtest', 97_400)).toBe('5,000 test sats');
    expect(formatAmount(5000, 'mock', 97_400).fiat).toBeNull();
  });
});
