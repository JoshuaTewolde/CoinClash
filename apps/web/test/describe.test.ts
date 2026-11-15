import type { MatchView } from '@coinclash/shared';
import { describe, expect, it } from 'vitest';
import { describeMatch, opponentName, outcome } from '../src/match/describe';
import { clampStake, parseStake } from '../src/screens/StakeInput';

const base: MatchView = {
  id: 'm',
  inviteCode: 'i',
  joinCode: null,
  gameId: 'tictactoe',
  status: 'PROPOSED',
  stake: 2000,
  proposals: [{ by: 'a', amount: 2000, at: 0 }],
  challenger: { id: 'a', nickname: 'Ann' },
  opponent: null,
  you: 'a',
  respondent: null,
  mode: 'escrow',
  escrow: null,
  locks: null,
  game: null,
  claimDeadline: null,
  claimedBy: [],
  opponentGraceEndsAt: null,
  rematchOf: null,
  rematchId: null,
  createdAt: 0,
  updatedAt: 0,
};
const withB: MatchView = { ...base, opponent: { id: 'b', nickname: 'Ben' } };

describe('describeMatch', () => {
  it('names the opponent from either side', () => {
    expect(opponentName(withB)).toBe('Ben');
    expect(opponentName({ ...withB, you: 'b' })).toBe('Ann');
    expect(opponentName(base)).toBe('a friend');
  });

  it('flags the viewer’s turn to act', () => {
    expect(describeMatch(base, 0).hot).toBe(false);
    const neg = { ...withB, status: 'NEGOTIATING' as const, respondent: 'a' };
    expect(describeMatch(neg, 0)).toEqual({ text: 'Your call · Ben offered 2,000', hot: true });
    expect(describeMatch({ ...neg, respondent: 'b' }, 0).hot).toBe(false);

    const locking = {
      ...withB,
      status: 'AWAITING_LOCKS' as const,
      locks: {
        lockToHash: '',
        incomingHash: '',
        opponentSparkAddress: '',
        htlcExpiresAt: 0,
        lockDeadline: 0,
        locked: { a: false, b: false },
      },
    };
    expect(describeMatch(locking, 0).hot).toBe(true);
    expect(describeMatch(locking, 0, true)).toEqual({
      text: 'Waiting for Ben to lock',
      hot: false,
    });

    const playing: MatchView = {
      ...withB,
      status: 'IN_PROGRESS',
      game: { view: null, waitingOn: ['a'], turnEndsAt: 61_000, result: { status: 'ongoing' } },
    };
    expect(describeMatch(playing, 0)).toEqual({ text: 'Your turn · 1:01 left', hot: true });
    expect(describeMatch({ ...playing, you: 'b' }, 0)).toEqual({ text: "Ann's turn", hot: false });
  });

  it('describes results and endings', () => {
    const done = (
      r: NonNullable<MatchView['game']>['result'],
      status: MatchView['status'] = 'SETTLED',
    ) =>
      ({
        ...withB,
        status,
        game: { view: null, waitingOn: [], turnEndsAt: null, result: r },
      }) as MatchView;
    expect(outcome(done({ status: 'win', winner: 'a', reason: 'normal' }))).toBe('won');
    expect(
      describeMatch(done({ status: 'win', winner: 'a', reason: 'normal' }, 'SETTLING'), 0).text,
    ).toBe('You won! Collecting…');
    expect(describeMatch(done({ status: 'win', winner: 'b', reason: 'normal' }), 0).text).toBe(
      'Ben won',
    );
    expect(describeMatch(done({ status: 'draw', reason: 'normal' }), 0).text).toBe('Draw');
    expect(describeMatch({ ...withB, status: 'DECLINED' }, 0).text).toBe('Declined');
    expect(describeMatch({ ...withB, status: 'CANCELLED' }, 0).text).toMatch(/locked in time/);
    expect(outcome(withB)).toBeNull();
  });
});

describe('stake parsing', () => {
  it('keeps digits only and clamps to the allowed range', () => {
    expect(parseStake('12,5a00')).toBe(12500);
    expect(parseStake('')).toBe(0);
    expect(clampStake(0, 100, 100_000)).toBe(100);
    expect(clampStake(999_999, 100, 100_000)).toBe(100_000);
    expect(clampStake(2500.4, 100, 100_000)).toBe(2500);
  });
});
