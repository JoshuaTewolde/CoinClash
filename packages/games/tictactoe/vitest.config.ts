import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'tictactoe', include: ['test/**/*.test.ts'] } });
