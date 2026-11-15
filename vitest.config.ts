import { defineConfig } from 'vitest/config';

// Root config: coverage settings apply across the workspace (see vitest.workspace.ts).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['apps/*/src/**', 'packages/**/src/**'],
      exclude: ['**/*.d.ts', '**/main.tsx', 'apps/server/src/index.ts'],
      // Spec §11: >= 90% for game engines and the match/escrow core.
      thresholds: {
        'packages/game-sdk/src/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'packages/games/*/src/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});
