import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'rail', include: ['test/**/*.test.ts'] } });
