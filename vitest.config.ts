import { defineConfig } from 'vitest/config';

// Root config: coverage settings apply across the workspace (see vitest.workspace.ts).
// Per-package coverage thresholds (>=90% for engines and escrow) are added as those land.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['apps/*/src/**', 'packages/**/src/**'],
      exclude: ['**/*.d.ts', '**/main.tsx', 'apps/server/src/index.ts'],
    },
  },
});
