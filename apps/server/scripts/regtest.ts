/* eslint-disable no-console -- CLI script: stdout is its interface. */
/**
 * Regtest tooling (Breez Spark, real regtest network). Never prints secrets except `mnemonic`,
 * which prints a NEW mnemonic for you to store yourself.
 *
 *   pnpm --filter @coinclash/server regtest mnemonic          # new 12-word mnemonic
 *   pnpm --filter @coinclash/server regtest info  <ENV_VAR>   # identity, spark address, balance
 *   pnpm --filter @coinclash/server regtest fund  <ENV_VAR> [sats]  # Lightspark faucet → deposit
 *   pnpm --filter @coinclash/server regtest smoke             # HTLC lock → find → claim, A→B→A
 *
 * `<ENV_VAR>` names an env var holding the mnemonic (e.g. HOUSE_MNEMONIC). Reads BREEZ_API_KEY.
 * The smoke test uses REGTEST_PLAYER_A_MNEMONIC / REGTEST_PLAYER_B_MNEMONIC, funding A from
 * HOUSE_MNEMONIC if it's short. It is what `.github/workflows/regtest.yml` runs.
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BreezSdk, Payment } from '@breeztech/breez-sdk-spark/nodejs';
import { idempotencyUuid, paymentHashOf } from '@coinclash/rail';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { breezHouseWallet, connectBreez } from '../src/breez.js';

const FAUCET_URL = process.env.FAUCET_URL ?? 'https://api.lightspark.com/graphql/spark/rc';
const STAKE = 1_000;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function wallet(envVar: string, tag: string): Promise<BreezSdk> {
  return connectBreez({
    network: 'regtest',
    apiKey: need('BREEZ_API_KEY'),
    mnemonic: need(envVar),
    storageDir: `./.data/regtest-${tag}`,
  });
}

async function sparkAddress(sdk: BreezSdk): Promise<string> {
  return (await sdk.receivePayment({ paymentMethod: { type: 'sparkAddress' } })).paymentRequest;
}

async function balance(sdk: BreezSdk): Promise<number> {
  await sdk.syncWallet({});
  return (await sdk.getInfo({ ensureSynced: true })).balanceSats;
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined>,
  secs = 120,
): Promise<T> {
  const until = Date.now() + secs * 1000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(2000);
  }
}

async function findIncomingHtlc(sdk: BreezSdk, paymentHash: string): Promise<Payment | null> {
  const { payments } = await sdk.listPayments({
    typeFilter: ['receive'],
    paymentDetailsFilter: [{ type: 'spark', htlcStatus: ['waitingForPreimage'] }],
  });
  return (
    payments.find(
      (p) => p.details?.type === 'spark' && p.details.htlcDetails?.paymentHash === paymentHash,
    ) ?? null
  );
}

async function lock(from: BreezSdk, to: string, amount: number, paymentHash: string, secs: number) {
  const prepareResponse = await from.prepareSendPayment({
    paymentRequest: { type: 'input', input: to },
    amount: BigInt(amount),
  });
  const fee =
    prepareResponse.paymentMethod.type === 'sparkAddress' ? prepareResponse.paymentMethod.fee : 0n;
  const { payment } = await from.sendPayment({
    prepareResponse,
    options: { type: 'sparkAddress', htlcOptions: { paymentHash, expiryDurationSecs: secs } },
    idempotencyKey: idempotencyUuid(`smoke-lock:${paymentHash}`),
  });
  return { payment, fee };
}

async function main() {
  const [cmd, arg, extra] = process.argv.slice(2);
  switch (cmd) {
    case 'mnemonic':
      console.log(generateMnemonic(wordlist, 128));
      return;

    case 'info': {
      const sdk = await wallet(arg ?? 'HOUSE_MNEMONIC', (arg ?? 'house').toLowerCase());
      const info = await sdk.getInfo({ ensureSynced: true });
      console.log({
        identity: info.identityPubkey,
        balanceSats: info.balanceSats,
        sparkAddress: await sparkAddress(sdk),
      });
      await sdk.disconnect();
      return;
    }

    case 'fund': {
      const envVar = arg ?? 'HOUSE_MNEMONIC';
      const amount = Number(extra ?? 50_000);
      const sdk = await wallet(envVar, envVar.toLowerCase());
      const before = await balance(sdk);
      const address = (await sdk.receivePayment({ paymentMethod: { type: 'bitcoinAddress' } }))
        .paymentRequest;
      console.log(`Requesting ${amount} sats from the faucet to ${address}…`);
      const res = await fetch(FAUCET_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'RequestRegtestFunds',
          variables: { amount_sats: amount, address },
          query:
            'mutation RequestRegtestFunds($address: String!, $amount_sats: Long!) { request_regtest_funds(input: {address: $address, amount_sats: $amount_sats}) { transaction_hash } }',
        }),
      });
      console.log(`faucet: ${res.status} ${await res.text()}`);
      const after = await waitFor(
        'the deposit to be claimed',
        async () => {
          const b = await balance(sdk);
          if (b > before) return b;
          const { deposits } = await sdk.listUnclaimedDeposits({});
          if (deposits.length)
            console.log(`unclaimed deposits: ${deposits.length} (waiting for confirmations)`);
          return null;
        },
        900,
      );
      console.log(`balance: ${before} → ${after} sats`);
      await sdk.disconnect();
      return;
    }

    case 'smoke': {
      const a = await wallet('REGTEST_PLAYER_A_MNEMONIC', 'player-a');
      const b = await wallet('REGTEST_PLAYER_B_MNEMONIC', 'player-b');
      const [addrA, addrB] = [await sparkAddress(a), await sparkAddress(b)];
      if ((await balance(a)) < STAKE * 2) {
        console.log('Player A is short; topping up from the house wallet');
        const house = await wallet('HOUSE_MNEMONIC', 'house');
        await breezHouseWallet(house).pay(addrA, STAKE * 5, `smoke-topup:${Date.now()}`);
        await waitFor('top-up', async () => ((await balance(a)) >= STAKE * 2 ? true : null));
        await house.disconnect();
      }
      const [a0, b0] = [await balance(a), await balance(b)];
      console.log({ a0, b0 });

      // A locks STAKE to B under H("B wins"). B sees it, then claims with the preimage.
      const preimage = randomBytes(32).toString('hex');
      const paymentHash = paymentHashOf(preimage);
      const { payment, fee } = await lock(a, addrB, STAKE, paymentHash, 600);
      console.log(
        `A locked ${STAKE} (fee ${fee}) → payment ${payment.id}, status ${payment.status}`,
      );
      const incoming = await waitFor('B to see the HTLC', () => findIncomingHtlc(b, paymentHash));
      const details = incoming.details?.type === 'spark' ? incoming.details.htlcDetails : undefined;
      console.log('B sees:', {
        id: incoming.id,
        amount: incoming.amount,
        status: incoming.status,
        htlc: details,
        nowSecs: Math.floor(Date.now() / 1000),
      });

      // Wrong preimage must fail.
      await b.claimHtlcPayment({ preimage: randomBytes(32).toString('hex') }).then(
        () => {
          throw new Error('claim with a wrong preimage succeeded!');
        },
        () => console.log('wrong preimage rejected ✓'),
      );
      const claimed = await b.claimHtlcPayment({ preimage });
      console.log(`B claimed: ${claimed.payment.id} ${claimed.payment.status}`);
      const after = await waitFor('B balance', async () => {
        const v = await balance(b);
        return v >= b0 + STAKE ? v : null;
      });
      console.log({ a1: await balance(a), b1: after });

      // Return the sats so the smoke test can run again: B pays A back (plain Spark payment).
      await breezHouseWallet(b).pay(addrA, STAKE, `smoke-return:${paymentHash}`);
      console.log('regtest HTLC smoke test passed ✓');
      await Promise.all([a.disconnect(), b.disconnect()]);
      return;
    }

    default:
      console.log('usage: regtest <mnemonic|info|fund|smoke> …');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
