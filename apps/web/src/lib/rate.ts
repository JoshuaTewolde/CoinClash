/** BTC/USD from the server (Breez fiat rates), fetched once per page load. */
import { useEffect, useState } from 'react';
import { api } from './api';

let cached: Promise<number | null> | null = null;

export function btcUsd(): Promise<number | null> {
  cached ??= api.rate().then(
    (r) => r.usd,
    () => {
      cached = null; // retry next time
      return null;
    },
  );
  return cached;
}

/** For tests. */
export function resetRate(): void {
  cached = null;
}

export function useBtcUsd(): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void btcUsd().then((r) => live && setRate(r));
    return () => {
      live = false;
    };
  }, []);
  return rate;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "≈ $1.94" for an amount of sats, or null without a rate. */
export function usdLabel(sats: number, rate: number | null): string | null {
  if (!rate || !Number.isFinite(sats)) return null;
  const v = (sats / 100_000_000) * rate;
  return `≈ ${v > 0 && v < 0.01 ? '< $0.01' : usd.format(v)}`;
}
