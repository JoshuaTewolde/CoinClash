import { NetworkSchema } from '@coinclash/shared';
import { z } from 'zod';

const ConfigSchema = z.object({
  NETWORK: NetworkSchema.default('regtest'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
