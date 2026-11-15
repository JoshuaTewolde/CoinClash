import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'trivia',
    include: ['test/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
  },
});
