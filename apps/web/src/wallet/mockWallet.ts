/**
 * NETWORK=mock wallet: talks to the server's shared in-memory Spark network (/api/mock-wallet,
 * ADR 0011). Offline dev and Playwright only; never used on regtest or mainnet.
 */
import type { IncomingLock, LockRequest, SignedMessage } from '@coinclash/rail';
import { mockSignature } from '@coinclash/rail/mock';
import type { AppWallet, IdentityProvider, WalletTx } from './types';

const KEY = 'cc.mockWallet';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/mock-wallet/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const reply = (await res.json()) as { ok: true; data: T } | { ok: false; error: string };
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export class HttpMockWallet implements AppWallet {
  constructor(readonly id: string) {}

  identity = async () => this.id;
  sparkAddress = async () => this.id;
  getBalance = async () => (await call<{ balance: number }>(this.id)).balance;
  estimateLockFee = async () => 0;
  signMessage = async (message: string): Promise<SignedMessage> => ({
    message,
    pubkey: this.id,
    signature: mockSignature(this.id, message),
  });
  lock = (req: LockRequest) => call<{ paymentId: string }>(`${this.id}/lock`, req);
  findIncomingLock = (hash: string) => call<IncomingLock | null>(`${this.id}/incoming/${hash}`);
  /** Polled by MatchAgent instead; kept for the interface. */
  onIncomingLock = () => () => undefined;
  claim = (preimage: string) =>
    call<{ paymentId: string; amount: number }>(`${this.id}/claim`, { preimage });
  history = () => call<WalletTx[]>(`${this.id}/history`);
  faucet = async () => {
    await call(`${this.id}/faucet`, {});
  };
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `mock-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const mockIdentity: IdentityProvider = {
  async register() {
    const id = randomId();
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: wallet lives for this tab only */
    }
    const w = new HttpMockWallet(id);
    await w.getBalance(); // opens the wallet (welcome sats)
    return w;
  },
  async signIn() {
    const id = read();
    if (!id) throw new Error('No account on this device yet. Create one first.');
    return new HttpMockWallet(id);
  },
  async restore() {
    const id = read();
    return id ? new HttpMockWallet(id) : null;
  },
  forget() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
