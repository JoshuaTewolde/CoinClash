import { NetworkSchema } from '@coinclash/shared';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-insecure-session-secret-change-me!!';

const ConfigSchema = z
  .object({
    NETWORK: NetworkSchema.default('regtest'),
    PORT: z.coerce.number().int().min(0).max(65535).default(8787),
    PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    /** `memory` = in-process store (tests, offline dev, E2E). Otherwise a MongoDB URI. */
    MONGODB_URI: z.string().min(1).default('memory'),
    MONGODB_DB: z.string().min(1).default('coinclash'),
    SESSION_SECRET: z.string().optional(),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 3600),
    STAKE_MIN_SATS: z.coerce.number().int().positive().default(100),
    STAKE_MAX_SATS: z.coerce.number().int().positive().default(100_000),
    LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
    CLAIM_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    DISCONNECT_GRACE_SECONDS: z.coerce.number().int().positive().default(60),
    WELCOME_BONUS_SATS: z.coerce.number().int().min(0).default(10_000),
    WELCOME_BONUS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    WELCOME_BONUS_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(0).default(5),
    /** Server house wallet (regtest/mainnet). Required outside mock; checked at startup. */
    BREEZ_API_KEY: z.string().optional(),
    HOUSE_MNEMONIC: z.string().optional(),
    BREEZ_STORAGE_DIR: z.string().min(1).default('./.data/breez-server'),
    /** Built web app (apps/web/dist). When set, the server also serves it (production image). */
    WEB_DIST_DIR: z.string().optional(),
    /** How stakes are held: `escrow` (active, ADR 0013) or `htlc` (dormant, ADR 0002). */
    ESCROW_MODE: z.enum(['escrow', 'htlc']).default('escrow'),
    /** Server escrow wallet (escrow mode, regtest/mainnet). Separate from the house wallet. */
    ESCROW_MNEMONIC: z.string().optional(),
  })
  .transform((c, ctx) => {
    let secret = c.SESSION_SECRET;
    if (!secret) {
      if (c.NETWORK !== 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message: 'required outside NETWORK=mock',
        });
        return z.NEVER;
      }
      secret = DEV_SECRET;
    }
    if (secret.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'must be at least 32 characters',
      });
      return z.NEVER;
    }
    if (c.STAKE_MIN_SATS > c.STAKE_MAX_SATS) {
      ctx.addIssue({
        code: 'custom',
        path: ['STAKE_MIN_SATS'],
        message: 'must be <= STAKE_MAX_SATS',
      });
      return z.NEVER;
    }
    return { ...c, SESSION_SECRET: secret };
  });

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
