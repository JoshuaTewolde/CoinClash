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
} from '@breeztech/breez-sdk-spark/nodejs';
import { idempotencyUuid, type SignatureVerifier, type SignedMessage } from '@coinclash/rail';

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
