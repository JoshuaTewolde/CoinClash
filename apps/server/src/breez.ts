/**
 * Server-side Breez SDK (Spark), Node build. The server's only wallet is the **house wallet**:
 * it pays welcome bonuses on regtest and verifies player signatures (`checkMessage`).
 * It never holds match funds (ADR 0002).
 *
 * Verified against @breeztech/breez-sdk-spark 0.28.4 (`./nodejs` export: no `init()` needed).
 */
import {
  connect,
  defaultConfig,
  type BreezSdk,
  type Network as BreezNetwork,
  type Payment,
} from '@breeztech/breez-sdk-spark/nodejs';
import {
  idempotencyUuid,
  type EscrowRail,
  type InvoicePayment,
  type SignatureVerifier,
  type SignedMessage,
} from '@coinclash/rail';

export interface BreezConnectOptions {
  readonly network: BreezNetwork;
  readonly apiKey: string;
  readonly mnemonic: string;
  readonly storageDir: string;
}

export async function connectBreez(opts: BreezConnectOptions): Promise<BreezSdk> {
  const config = defaultConfig(opts.network);
  config.apiKey = opts.apiKey;
  return connect({
    config,
    seed: { type: 'mnemonic', mnemonic: opts.mnemonic },
    storageDir: opts.storageDir,
  });
}

/** Verifies wallet signatures (compact or DER) with the SDK's `checkMessage`. */
export function breezVerifier(sdk: Pick<BreezSdk, 'checkMessage'>): SignatureVerifier {
  return {
    async verify({ message, pubkey, signature }: SignedMessage) {
      try {
        return (await sdk.checkMessage({ message, pubkey, signature })).isValid;
      } catch {
        return false;
      }
    },
  };
}

/** What the server needs from the house wallet (narrow, so tests can fake it). */
export interface HouseWallet {
  balance(): Promise<number>;
  /** Pay `amount` sats to a Spark address. `idempotencyKey` makes retries safe. */
  pay(sparkAddress: string, amount: number, idempotencyKey: string): Promise<string>;
}

export function breezHouseWallet(sdk: BreezSdk): HouseWallet {
  // A freshly connected SDK may not know its funds yet ("insufficient funds"): sync once first.
  let synced: Promise<unknown> | null = null;
  const ensureSynced = () => (synced ??= sdk.getInfo({ ensureSynced: true }));
  return {
    async balance() {
      await ensureSynced();
      return (await sdk.getInfo({ ensureSynced: false })).balanceSats;
    },
    async pay(sparkAddress, amount, idempotencyKey) {
      await ensureSynced();
      const prepareResponse = await sdk.prepareSendPayment({
        paymentRequest: { type: 'input', input: sparkAddress },
        amount: BigInt(amount),
      });
      const { payment } = await sdk.sendPayment({
        prepareResponse,
        idempotencyKey: idempotencyUuid(idempotencyKey),
      });
      return payment.id;
    },
  };
}

/**
 * The server's escrow wallet on Breez/Spark (ADR 0013). A separate mnemonic from the house wallet,
 * so pots and the welcome-bonus float never mix and the escrow balance can be audited per match.
 */
export function breezEscrow(sdk: BreezSdk): EscrowRail {
  let synced: Promise<unknown> | null = null;
  const ensureSynced = () => (synced ??= sdk.getInfo({ ensureSynced: true }));
  const toInvoicePayment = (p: Payment): InvoicePayment | null => {
    if (p.paymentType !== 'receive' || p.status !== 'completed') return null;
    if (p.details?.type !== 'spark' || !p.details.invoiceDetails) return null;
    return { invoice: p.details.invoiceDetails.invoice, paymentId: p.id, amount: Number(p.amount) };
  };

  return {
    async createInvoice({ amount, expiresAt, payerIdentity, memo }) {
      const res = await sdk.receivePayment({
        paymentMethod: {
          type: 'sparkInvoice',
          amount: BigInt(amount),
          expiryTime: expiresAt,
          description: memo,
          // Only this player's wallet can pay their deposit invoice.
          senderPublicKey: payerIdentity,
        },
      });
      return res.paymentRequest;
    },
    async findInvoicePayment(invoice) {
      const { payments } = await sdk.listPayments({
        typeFilter: ['receive'],
        statusFilter: ['completed'],
        limit: 200,
      });
      for (const p of payments) {
        const ip = toInvoicePayment(p);
        if (ip?.invoice === invoice) return ip;
      }
      return null;
    },
    onInvoicePaid(listener) {
      let id: string | null = null;
      let cancelled = false;
      void sdk
        .addEventListener({
          onEvent: (e) => {
            if (e.type !== 'paymentSucceeded') return;
            const ip = toInvoicePayment(e.payment);
            if (ip) listener(ip);
          },
        })
        .then((x) => {
          id = x;
          if (cancelled) void sdk.removeEventListener(x);
        });
      return () => {
        cancelled = true;
        if (id) void sdk.removeEventListener(id);
      };
    },
    async balance() {
      const info = await sdk.getInfo({ ensureSynced: false });
      return Number(info.balanceSats);
    },
    async pay(to, amount, idempotencyKey) {
      await ensureSynced();
      let prepareResponse = await sdk.prepareSendPayment({
        paymentRequest: { type: 'input', input: to },
        amount: BigInt(amount),
      });
      // Network fee (≈0 for Spark transfers) comes out of the pot, never out of the escrow float.
      const fee =
        prepareResponse.paymentMethod.type === 'sparkAddress'
          ? prepareResponse.paymentMethod.fee
          : 0n;
      if (fee > 0n) {
        prepareResponse = await sdk.prepareSendPayment({
          paymentRequest: { type: 'input', input: to },
          amount: BigInt(amount) - fee,
        });
      }
      const { payment } = await sdk.sendPayment({
        prepareResponse,
        idempotencyKey: idempotencyUuid(idempotencyKey),
      });
      if (payment.status === 'failed') throw new Error('Payout failed');
      return { paymentId: payment.id };
    },
    async paymentStatus(idempotencyKey) {
      try {
        // With an idempotency key, the payment's id IS that key (Breez docs).
        const { payment } = await sdk.getPayment({ paymentId: idempotencyUuid(idempotencyKey) });
        return payment.status;
      } catch {
        return null;
      }
    },
  };
}
