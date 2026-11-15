import type { Sats, WalletRail } from '@coinclash/rail';

export interface WalletTx {
  readonly paymentId: string;
  readonly direction: 'in' | 'out';
  readonly counterparty: string;
  readonly amount: Sats;
  readonly status: 'waiting' | 'claimed' | 'returned';
  /** Unix seconds. */
  readonly expiresAt: number;
}

/** The player's own wallet in the browser: the shared rail plus a few screen-only extras. */
export interface AppWallet extends WalletRail {
  history(): Promise<WalletTx[]>;
  /** Test-only top-up (mock faucet). Undefined where a real faucet link is used instead. */
  faucet?: () => Promise<void>;
}

/**
 * Creates or restores a wallet. Mirrors the passkey two-button flow (ADR 0003):
 * `register` makes a new wallet, `signIn` restores the one this device knows.
 */
export interface IdentityProvider {
  register(): Promise<AppWallet>;
  signIn(): Promise<AppWallet>;
  /** Restore silently (no user gesture), or null if this device has no wallet yet. */
  restore(): Promise<AppWallet | null>;
  forget(): void;
}
