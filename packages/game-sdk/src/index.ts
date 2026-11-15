/**
 * Game plug-in SDK. The full `GamePlugin` interface, seeded RNG and test helpers
 * land in Phase 2 (see docs/SPEC.md §3).
 */
export type PlayerId = string;

export const SUPPORTED_PLAYER_COUNT = { min: 2, max: 2 } as const;
