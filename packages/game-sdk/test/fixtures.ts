import { invalid, type GamePlugin, type PlayerId } from '../src/index.js';

/**
 * A tiny game for testing the SDK. Players alternately take 1 or 2 from a pile, and whoever takes
 * the last one wins. `onTimeout` skips the turn instead of forfeiting, and `onMatchCap` awards
 * the game to whoever is not on move, so the non-default hooks get exercised.
 */
export interface PileState {
  readonly players: readonly PlayerId[];
  readonly pile: number;
  readonly turn: number;
  readonly lastTaker: number | null;
}

export const pileGame: GamePlugin<PileState, { take: 1 | 2 }, { pile: number }> = {
  id: 'pile',
  name: 'Pile',
  minPlayers: 2,
  maxPlayers: 2,
  turnModel: 'alternating',
  defaultTurnSeconds: 10,
  maxMatchSeconds: 120,
  init: ({ players }) => ({ players, pile: 5, turn: 0, lastTaker: null }),
  activePlayers: (s) => (s.pile > 0 ? [s.players[s.turn]!] : []),
  validateMove(s, _player, move) {
    const take = (move as { take?: unknown } | null)?.take;
    if (take !== 1 && take !== 2) return invalid('take must be 1 or 2');
    if (take > s.pile) return invalid('not enough left');
    return { take };
  },
  applyMove: (s, _p, m) => ({ ...s, pile: s.pile - m.take, turn: 1 - s.turn, lastTaker: s.turn }),
  getResult: (s) =>
    s.pile === 0 && s.lastTaker !== null
      ? { status: 'win', winner: s.players[s.lastTaker]!, reason: 'normal' }
      : { status: 'ongoing' },
  viewFor: (s) => ({ pile: s.pile }),
  onTimeout: (s) => ({ ...s, turn: 1 - s.turn }),
  onMatchCap: (s) => ({ status: 'win', winner: s.players[1 - s.turn]!, reason: 'match-cap' }),
  legalMoves: (s) => (s.pile >= 2 ? [{ take: 1 }, { take: 2 }] : s.pile === 1 ? [{ take: 1 }] : []),
};
