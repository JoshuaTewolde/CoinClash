import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'connect4',
    include: ['test/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
  },
});
