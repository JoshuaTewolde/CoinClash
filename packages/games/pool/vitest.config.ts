import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'pool',
    include: ['test/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
  },
});
