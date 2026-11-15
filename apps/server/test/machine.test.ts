import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  isFinal,
  MatchError,
  nextDeadline,
  respondentOf,
} from '../src/match/machine.js';
import { games } from '../src/games.js';
import { opponentOf, playersOf } from '../src/match/types.js';
import { CONFIG, env, inProgress, newDoc, playCells, run, T0, toMove } from './helpers.js';

const err = (fn: () => unknown, msg: RegExp) => expect(fn).toThrow(msg);

describe('negotiation', () => {
  it('PROPOSED → NEGOTIATING when the invitee joins; rejoining is a no-op', () => {
    const { doc } = run(newDoc(), [{ type: 'join', player: 'bob' }]);
    expect(doc.status).toBe('NEGOTIATING');
    expect(doc.opponent).toBe('bob');
    expect(respondentOf(doc)).toBe('bob');
    expect(run(doc, [{ type: 'join', player: 'bob' }]).doc).toBe(doc);
    expect(run(doc, [{ type: 'join', player: 'alice' }]).doc).toBe(doc);
    err(() => run(doc, [{ type: 'join', player: 'eve' }]), /two players/);
    const declined = run(newDoc(), [{ type: 'decline', player: 'alice' }]).doc;
    err(() => run(declined, [{ type: 'join', player: 'bob' }]), /DECLINED/);
  });

  it('counter offers alternate; only the respondent may act', () => {
    const { doc } = run(newDoc(), [
      { type: 'join', player: 'bob' },
      { type: 'counter', player: 'bob', amount: 1000 },
    ]);
    expect(doc.proposals.map((p) => [p.by, p.amount])).toEqual([
      ['alice', 2000],
      ['bob', 1000],
    ]);
    expect(respondentOf(doc)).toBe('alice');
    err(() => run(doc, [{ type: 'accept', player: 'bob' }]), /other player/);
    err(() => run(doc, [{ type: 'counter', player: 'alice', amount: 1000 }]), /current proposal/);
    err(
      () => run(doc, [{ type: 'counter', player: 'alice', amount: 50 }]),
      /between 100 and 100000/,
    );
    err(() => run(doc, [{ type: 'counter', player: 'alice', amount: 100.5 }]), /between/);
  });

  it('accept agrees the latest proposal and starts the lock window', () => {
    const { doc } = run(newDoc(), [
      { type: 'join', player: 'bob' },
      { type: 'counter', player: 'bob', amount: 1500 },
      { type: 'accept', player: 'alice' },
    ]);
    expect(doc.status).toBe('AWAITING_LOCKS');
    expect(doc.stake).toBe(1500);
    expect(doc.lockDeadline).toBe(T0 + CONFIG.lockTimeoutMs);
    // lock window (180) + tic-tac-toe cap (600) + claim window (900)
    expect(doc.htlcExpiresAt).toBe(Math.ceil(T0 / 1000) + 180 + 600 + 900);
    expect(Object.keys(doc.secrets!)).toEqual(['alice', 'bob']);
    expect(doc.secrets!.alice!.hash).not.toBe(doc.secrets!.bob!.hash);
    expect(respondentOf(doc)).toBeNull();
  });

  it('take the lower picks the lower of the last two proposals', () => {
    const { doc } = run(newDoc({ stake: 5000 }), [
      { type: 'join', player: 'bob' },
      { type: 'counter', player: 'bob', amount: 2000 },
      { type: 'counter', player: 'alice', amount: 3000 },
      { type: 'takeLower', player: 'bob' },
    ]);
    expect(doc.stake).toBe(2000);
    expect(doc.status).toBe('AWAITING_LOCKS');
  });

  it('take the lower with a single proposal accepts it', () => {
    const { doc } = run(newDoc(), [
      { type: 'join', player: 'bob' },
      { type: 'takeLower', player: 'bob' },
    ]);
    expect(doc.stake).toBe(2000);
  });

  it('either player can decline before agreeing; strangers cannot', () => {
    const joined = run(newDoc(), [{ type: 'join', player: 'bob' }]).doc;
    expect(run(joined, [{ type: 'decline', player: 'alice' }]).doc.status).toBe('DECLINED');
    expect(run(joined, [{ type: 'decline', player: 'bob' }]).doc.status).toBe('DECLINED');
    expect(run(newDoc(), [{ type: 'decline', player: 'alice' }]).doc.status).toBe('DECLINED');
    err(() => run(joined, [{ type: 'decline', player: 'eve' }]), /not in this match/);
    err(() => run(inProgress(), [{ type: 'decline', player: 'alice' }]), /IN_PROGRESS/);
  });
});

describe('locks', () => {
  const agreed = () =>
    run(newDoc(), [
      { type: 'join', player: 'bob' },
      { type: 'accept', player: 'bob' },
    ]).doc;

  it('starts the game only when both players have seen their incoming lock', () => {
    const one = run(agreed(), [{ type: 'lockSeen', player: 'alice', paymentId: 'p1' }]).doc;
    expect(one.status).toBe('AWAITING_LOCKS');
    const both = run(one, [{ type: 'lockSeen', player: 'bob', paymentId: 'p2' }], T0 + 5000).doc;
    expect(both.status).toBe('IN_PROGRESS');
    expect(both.session?.gameId).toBe('tictactoe');
    expect(both.turnStartedAt).toBe(T0 + 5000);
    expect(both.matchCapAt).toBe(T0 + 5000 + 600_000);
  });

  it('duplicate lock confirmations are ignored', () => {
    const one = run(agreed(), [{ type: 'lockSeen', player: 'alice', paymentId: 'p1' }]).doc;
    expect(run(one, [{ type: 'lockSeen', player: 'alice', paymentId: 'p1' }]).doc).toBe(one);
  });

  it('rejects lock confirmations outside the lock window or from strangers', () => {
    err(() => run(newDoc(), [{ type: 'lockSeen', player: 'alice', paymentId: 'x' }]), /PROPOSED/);
    err(
      () => run(agreed(), [{ type: 'lockSeen', player: 'eve', paymentId: 'x' }]),
      /not in this match/,
    );
  });

  it('cancels when the lock window passes', () => {
    const doc = agreed();
    expect(run(doc, [{ type: 'tick' }], T0 + CONFIG.lockTimeoutMs - 1).doc).toBe(doc);
    const cancelled = run(doc, [{ type: 'tick' }], T0 + CONFIG.lockTimeoutMs).doc;
    expect(cancelled.status).toBe('CANCELLED');
    expect(isFinal(cancelled.status)).toBe(true);
  });
});

describe('playing and settling', () => {
  it('a win releases only the winner code and moves to SETTLING', () => {
    const start = inProgress();
    const x = toMove(start);
    const { doc, notices } = playCells(start, [0, 3, 1, 4, 2]);
    expect(doc.status).toBe('SETTLING');
    expect(doc.result).toEqual({ status: 'win', winner: x, reason: 'normal' });
    expect(doc.released).toEqual([x]);
    expect(notices).toEqual([
      {
        type: 'releaseCode',
        to: x,
        preimage: doc.secrets![x]!.preimage,
        hash: doc.secrets![x]!.hash,
      },
    ]);
    expect(doc.claimDeadline).toBe(doc.htlcExpiresAt! * 1000 - 30_000);
  });

  it('a draw releases both codes', () => {
    const { doc, notices } = playCells(inProgress(), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(doc.result).toEqual({ status: 'draw', reason: 'normal' });
    expect([...doc.released].sort()).toEqual(['alice', 'bob']);
    expect(notices.map((n) => n.to).sort()).toEqual(['alice', 'bob']);
  });

  it('rejects illegal moves, wrong turns and strangers', () => {
    const doc = inProgress();
    const other = opponentOf(doc, toMove(doc))!;
    err(() => run(doc, [{ type: 'move', player: other, move: { cell: 0 } }]), /Not your turn/);
    err(() => run(doc, [{ type: 'move', player: toMove(doc), move: { cell: 42 } }]), /cell/);
    err(() => run(doc, [{ type: 'move', player: 'eve', move: { cell: 0 } }]), /not in this match/);
    err(() => run(newDoc(), [{ type: 'move', player: 'alice', move: { cell: 0 } }]), /PROPOSED/);
  });

  it('resigning forfeits to the opponent', () => {
    const { doc } = run(inProgress(), [{ type: 'resign', player: 'alice' }]);
    expect(doc.result).toMatchObject({ status: 'win', winner: 'bob', reason: 'forfeit' });
    expect(doc.status).toBe('SETTLING');
  });

  it('turn timer forfeits the player on move', () => {
    const doc = inProgress();
    const x = toMove(doc);
    const turnMs = games.get('tictactoe')!.defaultTurnSeconds * 1000;
    expect(nextDeadline(doc, games)).toBe(T0 + turnMs);
    expect(run(doc, [{ type: 'tick' }], T0 + turnMs - 1).doc).toBe(doc);
    const { doc: after } = run(doc, [{ type: 'tick' }], T0 + turnMs);
    expect(after.result).toMatchObject({
      status: 'win',
      winner: opponentOf(doc, x),
      reason: 'timeout',
    });
  });

  it('each move restarts the turn timer', () => {
    const doc = inProgress();
    const { doc: after } = playCells(doc, [4], T0 + 10_000);
    expect(after.turnStartedAt).toBe(T0 + 10_000);
  });

  it('disconnect starts a grace period; reconnecting cancels it; expiry forfeits', () => {
    const doc = inProgress();
    const gone = run(doc, [{ type: 'disconnected', player: 'bob' }], T0 - 1000).doc;
    expect(gone.graceEndsAt.bob).toBe(T0 - 1000 + CONFIG.disconnectGraceMs);
    expect(run(gone, [{ type: 'disconnected', player: 'bob' }]).doc).toBe(gone);
    // Grace (T0+59 s) ends before the 60 s turn timer.
    expect(nextDeadline(gone, games)).toBe(T0 - 1000 + CONFIG.disconnectGraceMs);

    const back = run(gone, [{ type: 'connected', player: 'bob' }]).doc;
    expect(back.graceEndsAt).toEqual({});
    expect(run(back, [{ type: 'connected', player: 'bob' }]).doc).toBe(back);

    const forfeited = run(gone, [{ type: 'tick' }], T0 - 1000 + CONFIG.disconnectGraceMs).doc;
    expect(forfeited.result).toMatchObject({ winner: 'alice' });
    expect(forfeited.graceEndsAt).toEqual({});
  });

  it('presence changes outside a live game are ignored', () => {
    const doc = newDoc();
    expect(run(doc, [{ type: 'disconnected', player: 'alice' }]).doc).toBe(doc);
  });

  it('the match cap ends the game as a draw', () => {
    let doc = inProgress();
    // Keep moving just before each turn timer so only the cap can end it.
    doc = { ...doc, turnStartedAt: T0 + 600_000 };
    const { doc: capped } = run(doc, [{ type: 'tick' }], T0 + 600_000);
    expect(capped.result).toEqual({ status: 'draw', reason: 'match-cap' });
  });
});

describe('claims', () => {
  const won = () => playCells(inProgress(), [0, 3, 1, 4, 2]).doc;

  it('SETTLING → SETTLED when every released code is claimed', () => {
    const doc = won();
    const winner = doc.released[0]!;
    const loser = opponentOf(doc, winner)!;
    err(() => run(doc, [{ type: 'claimed', player: loser }]), /No winnings/);
    const settled = run(doc, [{ type: 'claimed', player: winner }]).doc;
    expect(settled.status).toBe('SETTLED');
    err(() => run(settled, [{ type: 'claimed', player: winner }]), /SETTLED/);
  });

  it('draws settle after both claims; repeated claims are no-ops', () => {
    const draw = playCells(inProgress(), [0, 1, 2, 4, 3, 5, 7, 6, 8]).doc;
    const one = run(draw, [{ type: 'claimed', player: 'alice' }]).doc;
    expect(one.status).toBe('SETTLING');
    expect(run(one, [{ type: 'claimed', player: 'alice' }]).doc).toBe(one);
    expect(run(one, [{ type: 'claimed', player: 'bob' }]).doc.status).toBe('SETTLED');
  });

  it('expires if nobody confirms a claim before the deadline', () => {
    const doc = won();
    expect(nextDeadline(doc, games)).toBe(doc.claimDeadline);
    expect(run(doc, [{ type: 'tick' }], doc.claimDeadline! - 1).doc).toBe(doc);
    expect(run(doc, [{ type: 'tick' }], doc.claimDeadline!).doc.status).toBe('EXPIRED');
  });
});

describe('bookkeeping', () => {
  it('logs every transition with a cause', () => {
    const { doc } = playCells(inProgress(), [0, 3, 1, 4, 2]);
    expect(doc.transitions.map((t) => t.to)).toEqual([
      'PROPOSED',
      'NEGOTIATING',
      'AWAITING_LOCKS',
      'IN_PROGRESS',
      'SETTLING',
    ]);
    expect(doc.transitions.every((t) => t.cause.length > 0)).toBe(true);
  });

  it('final and idle states have no deadlines and ignore ticks', () => {
    const declined = run(newDoc(), [{ type: 'decline', player: 'alice' }]).doc;
    expect(nextDeadline(declined, games)).toBeNull();
    expect(nextDeadline(newDoc(), games)).toBeNull();
    expect(applyCommand(declined, { type: 'tick' }, env(T0 + 1e9)).doc).toBe(declined);
  });

  it('unknown games are rejected', () => {
    const doc = { ...run(newDoc(), [{ type: 'join', player: 'bob' }]).doc, gameId: 'chess' };
    expect(() => run(doc, [{ type: 'accept', player: 'bob' }])).toThrow(MatchError);
  });

  it('players helpers', () => {
    expect(playersOf(newDoc())).toEqual(['alice']);
    expect(opponentOf(newDoc(), 'alice')).toBeNull();
    expect(opponentOf(newDoc(), 'eve')).toBeNull();
  });
});
