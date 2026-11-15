import { z } from 'zod';

/** `mock` is for tests, CI and offline UI dev only: never exposed to players. */
export const NetworkSchema = z.enum(['mock', 'regtest', 'mainnet']);
export type Network = z.infer<typeof NetworkSchema>;
