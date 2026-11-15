import type { Sats, WalletRail } from '@coinclash/rail';

export interface WalletTx {
  readonly paymentId: string;
  readonly direction: 'in' | 'out';
  readonly counterparty: string;
  readonly amount: Sats;
  /** HTLC locks: waiting/claimed/returned. Plain payments: completed/pending/failed. */
  readonly status: 'waiting' | 'claimed' | 'returned' | 'completed' | 'pending' | 'failed';
  /** Unix seconds (lock expiry, or the payment time). */
  readonly expiresAt: number;
  readonly kind: 'lock' | 'payment' | 'deposit';
}

/** The player's own wallet in the browser: the shared rail plus a few screen-only extras. */
export interface AppWallet extends WalletRail {
  history(): Promise<WalletTx[]>;
  /** Test-only top-up (mock faucet). Undefined where a real faucet link is used instead. */
  faucet?: () => Promise<void>;
  /** Called when the balance may have changed (payments, sync). Returns an unsubscribe. */
  onChange?: (listener: () => void) => () => void;
  /** On-chain address for faucet/deposits (regtest faucet flow). */
  depositAddress?: () => Promise<string>;
  /** Pay a Spark address or invoice. */
  send?: (destination: string, amount: Sats) => Promise<void>;
  disconnect?: () => Promise<void>;
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
