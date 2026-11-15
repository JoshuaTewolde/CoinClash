/**
 * NETWORK=mock only: a shared in-memory Spark network that browsers reach over HTTP, so two
 * browser tabs (or two Playwright contexts) can pay each other without Breez (ADR 0011).
 *
 * This is test/offline-dev plumbing and is **never mounted on regtest or mainnet**: there,
 * each player's wallet is the Breez SDK running in their own browser.
 */
import { MockNetwork } from '@coinclash/rail/mock';
import express, { type Router } from 'express';
import { z } from 'zod';

const WalletId = z
  .string()
  .regex(/^mock-[a-z0-9]{8,40}$/)
  .max(48);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const LockBody = z.object({
  to: WalletId,
  amount: z.number().int().positive().max(1_000_000),
  paymentHash: Hash,
  expirySecs: z
    .number()
    .int()
    .positive()
    .max(24 * 3600),
});
const ClaimBody = z.object({ preimage: z.string().regex(/^[0-9a-f]{64}$/) });

const PayInvoiceBody = z.object({
  invoice: z.string().min(1).max(512),
  key: z.string().min(1).max(256),
});

export interface MockWalletOptions {
  /** Sats a brand-new wallet starts with (stands in for the regtest welcome bonus). */
  readonly welcomeSats: number;
  /** Clock in Unix seconds. */
  readonly now?: () => number;
  /** Share a network (e.g. with the mock escrow). */
  readonly net?: MockNetwork;
}

export function mockWalletRouter(opts: MockWalletOptions): { router: Router; net: MockNetwork } {
  const net = opts.net ?? new MockNetwork(opts.now);
  const known = new Set<string>();
  const router = express.Router();

  const wallet = (raw: unknown) => {
    const id = WalletId.parse(raw);
    if (!known.has(id)) {
      known.add(id);
      net.wallet(id, opts.welcomeSats);
    }
    return net.wallet(id);
  };

  const handle =
    (fn: (req: express.Request) => Promise<unknown> | unknown) =>
    async (req: express.Request, res: express.Response) => {
      try {
        res.json({ ok: true, data: await fn(req) });
      } catch (err) {
        const message =
          err instanceof z.ZodError
            ? 'Invalid request'
            : err instanceof Error
              ? err.message
              : 'Failed';
        res.status(400).json({ ok: false, error: message });
      }
    };

  router.get(
    '/:id',
    handle(async (req) => {
      const w = wallet(req.params.id);
      return { id: w.id, balance: await w.getBalance() };
    }),
  );
  router.get(
    '/:id/history',
    handle((req) => {
      const id = wallet(req.params.id).id;
      return net
        .allLocks()
        .filter((l) => l.from === id || l.to === id)
        .map((l) => ({
          paymentId: l.paymentId,
          direction: l.from === id ? 'out' : 'in',
          counterparty: l.from === id ? l.to : l.from,
          amount: l.amount,
          status: l.status,
          expiresAt: l.expiresAt,
          kind: 'lock',
        }))
        .reverse();
    }),
  );
  router.post(
    '/:id/lock',
    handle((req) => wallet(req.params.id).lock(LockBody.parse(req.body))),
  );
  router.get(
    '/:id/incoming/:hash',
    handle((req) => wallet(req.params.id).findIncomingLock(Hash.parse(req.params.hash))),
  );
  router.post(
    '/:id/claim',
    handle((req) => wallet(req.params.id).claim(ClaimBody.parse(req.body).preimage)),
  );
  router.post(
    '/:id/pay-invoice',
    handle((req) => {
      const body = PayInvoiceBody.parse(req.body);
      return wallet(req.params.id).payInvoice(body.invoice, body.key);
    }),
  );
  router.post(
    '/:id/faucet',
    handle(async (req) => {
      const w = wallet(req.params.id);
      net.fund(w.id, 10_000);
      return { balance: await w.getBalance() };
    }),
  );

  return { router, net };
}
