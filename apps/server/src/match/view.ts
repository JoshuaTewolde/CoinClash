import { sessionResult, waitingOn, type AnyGamePlugin } from '@coinclash/game-sdk';
import type { MatchView, PlayerSummary } from '@coinclash/shared';
import { respondentOf } from './machine.js';
import { opponentOf, playersOf, type MatchDoc } from './types.js';

export interface UserInfo {
  readonly nickname: string;
  readonly sparkAddress: string;
}

/**
 * What `viewer` may see of a match. **Never includes preimages** (those only go out via
 * `match:code` to the player they pay), and game state only goes through the plug-in's `viewFor`.
 */
export function viewFor(
  doc: MatchDoc,
  viewer: string | null,
  plugin: AnyGamePlugin,
  users: ReadonlyMap<string, UserInfo>,
): MatchView {
  const summary = (id: string): PlayerSummary => ({
    id,
    nickname: users.get(id)?.nickname ?? 'Player',
  });
  const isPlayer = viewer !== null && playersOf(doc).includes(viewer);
  const you = isPlayer ? viewer : null;
  const opp = you ? opponentOf(doc, you) : null;

  const locks =
    you && opp && doc.secrets && doc.htlcExpiresAt !== null && doc.lockDeadline !== null
      ? {
          lockToHash: doc.secrets[opp]!.hash,
          incomingHash: doc.secrets[you]!.hash,
          opponentSparkAddress: users.get(opp)?.sparkAddress ?? '',
          htlcExpiresAt: doc.htlcExpiresAt,
          lockDeadline: doc.lockDeadline,
          locked: Object.fromEntries(
            playersOf(doc).map((p) => [p, Boolean(doc.lockSeenBy[opponentOf(doc, p) ?? ''])]),
          ),
        }
      : null;

  const game = doc.session
    ? {
        view: plugin.viewFor(doc.session.state, you),
        waitingOn: waitingOn(plugin, doc.session),
        turnEndsAt:
          doc.status === 'IN_PROGRESS' && doc.turnStartedAt !== null
            ? doc.turnStartedAt + plugin.defaultTurnSeconds * 1000
            : null,
        result: sessionResult(plugin, doc.session),
      }
    : null;

  return {
    id: doc._id,
    inviteCode: doc.inviteCode,
    gameId: doc.gameId,
    status: doc.status,
    stake: doc.stake,
    proposals: doc.proposals,
    challenger: summary(doc.challenger),
    opponent: doc.opponent ? summary(doc.opponent) : null,
    you,
    respondent: respondentOf(doc),
    locks,
    game,
    claimDeadline: doc.claimDeadline,
    claimedBy: doc.claimedBy,
    opponentGraceEndsAt: opp ? (doc.graceEndsAt[opp] ?? null) : null,
    rematchOf: doc.rematchOf,
    rematchId: doc.rematchId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
