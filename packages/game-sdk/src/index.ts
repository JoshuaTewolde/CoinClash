/**
 * Game plug-in SDK. Games implement `GamePlugin` and know only their rules.
 * The server drives them through the session helpers (submitMove, timeoutPlayer, ...).
 * Test helpers live in `@coinclash/game-sdk/testing`.
 */
export * from './types.js';
export * from './rng.js';
export * from './session.js';

export const SUPPORTED_PLAYER_COUNT = { min: 2, max: 2 } as const;
