import { expect, it } from 'vitest';
import { SUPPORTED_PLAYER_COUNT } from '../src/index.js';

it('is 2-player only in v1', () => {
  expect(SUPPORTED_PLAYER_COUNT).toEqual({ min: 2, max: 2 });
});
