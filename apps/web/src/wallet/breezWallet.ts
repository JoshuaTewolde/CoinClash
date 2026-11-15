/**
 * The player's real wallet: Breez SDK (Spark) running in the browser, unlocked by a passkey
 * (ADR 0003). Implements the same `WalletRail` the MatchAgent uses with the mock, so the escrow
 * flow (ADR 0002) is identical on regtest/mainnet.
 *
 * Verified against @breeztech/breez-sdk-spark 0.28.4: `init()` (WASM) before anything else;
 * amounts are `bigint`; HTLC sends use `options.htlcOptions`; claims use `claimHtlcPayment`;
 * idempotency keys must be UUIDs.
 */
import initBreez, {
  connect,
  defaultConfig,
  type BreezSdk,
  type Payment,
  type Seed,
} from '@breeztech/breez-sdk-spark/web';
import {
  PasskeyClientBuilder,
  PasskeyProvider,
  PasskeyUserCancelledError,
} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
import {
  idempotencyUuid,
  type IncomingLock,
  type LockRequest,
  type SignedMessage,
} from '@coinclash/rail';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { AppWallet, IdentityProvider, WalletTx } from './types';
import { clearVault, loadFromVault, saveToVault } from './vault';

export type BreezNetwork = 'regtest' | 'mainnet';

const WALLET_LABEL = 'coinclash';
const RETURNING_KEY = 'cc.passkey.used';

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initBreez();
  return wasmReady;
}

function htlcOf(p: Payment) {
  return p.details?.type === 'spark' ? p.details.htlcDetails : undefined;
}

function lockStatus(
  s: 'waitingForPreimage' | 'preimageShared' | 'returned',
): IncomingLock['status'] {
  return s === 'waitingForPreimage' ? 'waiting' : s === 'preimageShared' ? 'claimed' : 'returned';
}

export class BreezWallet implements AppWallet {
  private address: string | null = null;

  constructor(private readonly sdk: BreezSdk) {}

  identity = async () => (await this.sdk.getInfo({ ensureSynced: false })).identityPubkey;

  sparkAddress = async () => {
    this.address ??= (
      await this.sdk.receivePayment({ paymentMethod: { type: 'sparkAddress' } })
    ).paymentRequest;
    return this.address;
  };

  getBalance = async () => (await this.sdk.getInfo({ ensureSynced: false })).balanceSats;

  estimateLockFee = async (to: string, amount: number) => {
    const prep = await this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input: to },
      amount: BigInt(amount),
    });
    return prep.paymentMethod.type === 'sparkAddress' ? Number(prep.paymentMethod.fee) : 0;
  };

  signMessage = async (message: string): Promise<SignedMessage> => {
    const r = await this.sdk.signMessage({ message, compact: true });
    return { message, pubkey: r.pubkey, signature: r.signature };
  };

  lock = async (req: LockRequest) => {
    const prepareResponse = await this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input: req.to },
      amount: BigInt(req.amount),
    });
    const { payment } = await this.sdk.sendPayment({
      prepareResponse,
      options: {
        type: 'sparkAddress',
        htlcOptions: { paymentHash: req.paymentHash, expiryDurationSecs: req.expirySecs },
      },
      // Same hash → same payment: a retry or double tap can never lock twice.
      idempotencyKey: idempotencyUuid(`lock:${req.paymentHash}`),
    });
    return { paymentId: payment.id };
  };

  /** Pay an escrow deposit invoice (ADR 0013). The amount comes from the invoice itself. */
  payInvoice = async (invoice: string, idempotencyKey: string) => {
    const prepareResponse = await this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input: invoice },
    });
    const { payment } = await this.sdk.sendPayment({
      prepareResponse,
      idempotencyKey: idempotencyUuid(idempotencyKey),
    });
    if (payment.status === 'failed') throw new Error('Payment failed');
    return { paymentId: payment.id };
  };

  private toIncoming(p: Payment): IncomingLock | null {
    const h = htlcOf(p);
    if (!h || p.paymentType !== 'receive') return null;
    return {
      paymentId: p.id,
      from: '',
      amount: Number(p.amount),
      paymentHash: h.paymentHash,
      expiresAt: h.expiryTime,
      status: lockStatus(h.status),
    };
  }

  findIncomingLock = async (paymentHash: string) => {
    const { payments } = await this.sdk.listPayments({
      typeFilter: ['receive'],
      paymentDetailsFilter: [
        { type: 'spark', htlcStatus: ['waitingForPreimage', 'preimageShared', 'returned'] },
      ],
      limit: 100,
    });
    const p = payments.find((x) => htlcOf(x)?.paymentHash === paymentHash);
    return p ? this.toIncoming(p) : null;
  };

  onIncomingLock = (listener: (lock: IncomingLock) => void) => {
    let id: string | null = null;
    let cancelled = false;
    void this.sdk
      .addEventListener({
        onEvent: (e) => {
          if (e.type !== 'paymentPending' && e.type !== 'paymentSucceeded') return;
          const lock = this.toIncoming(e.payment);
          if (lock) listener(lock);
        },
      })
      .then((x) => {
        id = x;
        if (cancelled) void this.sdk.removeEventListener(x);
      });
    return () => {
      cancelled = true;
      if (id) void this.sdk.removeEventListener(id);
    };
  };

  claim = async (preimage: string) => {
    const { payment } = await this.sdk.claimHtlcPayment({ preimage });
    return { paymentId: payment.id, amount: Number(payment.amount) };
  };

  history = async (): Promise<WalletTx[]> => {
    const { payments } = await this.sdk.listPayments({ limit: 50 });
    return payments.map((p) => {
      const h = htlcOf(p);
      return {
        paymentId: p.id,
        direction: p.paymentType === 'send' ? 'out' : 'in',
        counterparty: '',
        amount: Number(p.amount),
        status: h ? lockStatus(h.status) : p.status,
        expiresAt: h?.expiryTime ?? p.timestamp,
        kind: h ? 'lock' : p.method === 'deposit' ? 'deposit' : 'payment',
      };
    });
  };

  onChange = (listener: () => void) => {
    let id: string | null = null;
    let cancelled = false;
    void this.sdk
      .addEventListener({
        onEvent: (e) => {
          if (
            e.type === 'synced' ||
            e.type === 'paymentSucceeded' ||
            e.type === 'paymentPending' ||
            e.type === 'paymentFailed' ||
            e.type === 'claimedDeposits'
          )
            listener();
        },
      })
      .then((x) => {
        id = x;
        if (cancelled) void this.sdk.removeEventListener(x);
      });
    return () => {
      cancelled = true;
      if (id) void this.sdk.removeEventListener(id);
    };
  };

  depositAddress = async () =>
    (await this.sdk.receivePayment({ paymentMethod: { type: 'bitcoinAddress' } })).paymentRequest;

  send = async (destination: string, amount: number) => {
    const prepareResponse = await this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input: destination.trim() },
      amount: BigInt(amount),
    });
    await this.sdk.sendPayment({ prepareResponse });
  };

  disconnect = () => this.sdk.disconnect();
}

export interface PasskeyIdentityOptions {
  readonly network: BreezNetwork;
  readonly apiKey: string;
  readonly rpId: string;
  readonly rpName: string;
}

/** One IndexedDB store per wallet, so two accounts on one browser never share state. */
function storageNameFor(seed: Seed, network: BreezNetwork): string {
  const digest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(seed)))).slice(0, 16);
  return `coinclash-${network}-${digest}`;
}

async function openWallet(seed: Seed, opts: PasskeyIdentityOptions): Promise<BreezWallet> {
  await ensureWasm();
  const config = defaultConfig(opts.network);
  config.apiKey = opts.apiKey;
  const sdk = await connect({ config, seed, storageDir: storageNameFor(seed, opts.network) });
  return new BreezWallet(sdk);
}

function friendlyPasskeyError(err: unknown): Error {
  if (err instanceof PasskeyUserCancelledError) return new Error('Passkey prompt was closed.');
  if (err instanceof Error) return err;
  return new Error('Passkey sign-in failed');
}

/** Passkey identity provider (two-button flow, ADR 0003). */
export function passkeyIdentity(opts: PasskeyIdentityOptions): IdentityProvider {
  let client: ReturnType<PasskeyClientBuilder['build']> | null = null;
  const passkeys = async () => {
    await ensureWasm();
    client ??= new PasskeyClientBuilder(opts.apiKey, {
      providerOptions: { rpId: opts.rpId, rpName: opts.rpName },
    })
      .withPrfProvider(new PasskeyProvider({ rpId: opts.rpId, rpName: opts.rpName }))
      .build();
    const availability = await client.checkAvailability();
    if (availability.type === 'prfUnsupported') {
      throw new Error('This browser can’t unlock a passkey wallet. Please use Chrome.');
    }
    if (availability.type === 'notAssociated') {
      throw new Error(`Passkeys aren’t set up for this site (${availability.reason}).`);
    }
    return client;
  };
  const remember = () => {
    try {
      localStorage.setItem(RETURNING_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return {
    async register() {
      try {
        const { wallet } = await (await passkeys()).register({ label: WALLET_LABEL });
        remember();
        await saveToVault(wallet.seed, opts.network);
        return await openWallet(wallet.seed, opts);
      } catch (err) {
        throw friendlyPasskeyError(err);
      }
    },
    async signIn() {
      try {
        const { wallet } = await (await passkeys()).signIn({ label: WALLET_LABEL });
        remember();
        await saveToVault(wallet.seed, opts.network);
        return await openWallet(wallet.seed, opts);
      } catch (err) {
        throw friendlyPasskeyError(err);
      }
    },
    // Silent restore only from the device vault (ADR 0015); otherwise the app shows "Unlock".
    async restore() {
      const entry = await loadFromVault<Seed>(opts.network);
      return entry ? openWallet(entry.seed, opts) : null;
    },
    forget() {
      void clearVault();
      try {
        localStorage.removeItem(RETURNING_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
