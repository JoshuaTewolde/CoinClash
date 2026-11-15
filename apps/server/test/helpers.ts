import { paymentHashOf } from '@coinclash/rail';
import { games } from '../src/games.js';
import {
  applyCommand,
  createMatchDoc,
  type MachineConfig,
  type MachineEnv,
  type MatchCommand,
} from '../src/match/machine.js';
import type { MatchDoc, Secret } from '../src/match/types.js';

export const CONFIG: MachineConfig = {
  stakeMin: 100,
  stakeMax: 100_000,
  lockTimeoutMs: 180_000,
  claimWindowSeconds: 900,
  disconnectGraceMs: 60_000,
};

/** Deterministic secrets: preimage = player initial repeated. */
export function fixedSecrets(players: readonly string[]): Record<string, Secret> {
  return Object.fromEntries(
    players.map((p, i) => {
      const preimage = (i === 0 ? 'a1' : 'b2').repeat(32);
      return [p, { preimage, hash: paymentHashOf(preimage) }];
    }),
  );
}

export const T0 = 1_800_000_000_000;

export function env(now: number): MachineEnv {
  return { now, plugins: games, config: CONFIG, makeSecrets: fixedSecrets };
}

export function newDoc(overrides: Partial<Parameters<typeof createMatchDoc>[0]> = {}): MatchDoc {
  return createMatchDoc({
    id: 'm1',
    inviteCode: 'invite-1',
    seed: 'seed-1',
    gameId: 'tictactoe',
    options: null,
    stake: 2000,
    challenger: 'alice',
    now: T0,
    mode: 'htlc', // these helpers drive the (dormant) HTLC flow; escrow has its own tests
    ...overrides,
  });
}

/** Apply commands in sequence at time `now`, throwing on the first error. */
export function run(doc: MatchDoc, cmds: MatchCommand[], now = T0) {
  let cur = doc;
  const notices = [];
  for (const cmd of cmds) {
    const r = applyCommand(cur, cmd, env(now));
    cur = r.doc;
    notices.push(...r.notices);
  }
  return { doc: cur, notices };
}

/** A match where both stakes are locked and the game is in progress. */
export function inProgress(now = T0): MatchDoc {
  return run(
    newDoc(),
    [
      { type: 'join', player: 'bob' },
      { type: 'accept', player: 'bob' },
      { type: 'lockSeen', player: 'alice', paymentId: 'p-a' },
      { type: 'lockSeen', player: 'bob', paymentId: 'p-b' },
    ],
    now,
  ).doc;
}

/** Whose turn it is in a tic-tac-toe match. */
export function toMove(doc: MatchDoc): string {
  const s = doc.session!.state as { players: string[]; turn: 0 | 1 };
  return s.players[s.turn]!;
}

/** Play cells alternately from whoever is on move. */
export function playCells(doc: MatchDoc, cells: number[], now = T0) {
  let cur = doc;
  const notices = [];
  for (const cell of cells) {
    const r = applyCommand(cur, { type: 'move', player: toMove(cur), move: { cell } }, env(now));
    cur = r.doc;
    notices.push(...r.notices);
  }
  return { doc: cur, notices };
}
