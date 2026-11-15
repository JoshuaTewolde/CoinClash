/** Direct friend challenges, 6-digit join codes, push notifications and wallet activity (#4, #7). */
import { MockEscrow, MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import { describe, expect, it, vi } from 'vitest';
import { activityFor } from '../src/activity.js';
import { MemoryMatchRepo, MemoryPushRepo, MemoryUserRepo } from '../src/db/repos.js';
import { games } from '../src/games.js';
import { MatchService } from '../src/match/service.js';
import type { MatchDoc } from '../src/match/types.js';
import { webPushNotifier, type PushMessage } from '../src/push.js';
import { CONFIG, newDoc } from './helpers.js';

async function setup() {
  const net = new MockNetwork();
  const users = new MemoryUserRepo();
  for (const id of ['alice', 'bob', 'carol']) {
    await users.upsert({
      _id: id,
      nickname: id.toUpperCase(),
      sparkAddress: id,
      createdAt: 0,
      lastLoginAt: 0,
      bonusPaidAt: null,
    });
  }
  const pushed: { to: string; msg: PushMessage }[] = [];
  const matches = new MemoryMatchRepo();
  const service = new MatchService({
    matches,
    users,
    plugins: games,
    verifier: mockVerifier,
    config: CONFIG,
    escrow: new MockEscrow(net),
    notifier: { notify: async (to, msg) => void pushed.push({ to, msg }) },
    events: { changed: vi.fn(), codeReleased: vi.fn() },
  });
  return { service, matches, pushed };
}

describe('direct challenges', () => {
  it('only friends (people you have played) can be challenged directly; they get a push', async () => {
    const { service, matches, pushed } = await setup();
    await expect(
      service.create('alice', { gameId: 'tictactoe', stake: 500, opponentId: 'bob' }),
    ).rejects.toThrow(/Send a link instead/);
    await expect(
      service.create('alice', { gameId: 'tictactoe', stake: 500, opponentId: 'alice' }),
    ).rejects.toThrow(/yourself/);

    // Play once via an invite so they become friends.
    const open = await service.create('alice', { gameId: 'tictactoe', stake: 500 });
    expect(open.joinCode).toMatch(/^\d{6}$/);
    expect(await service.inviteForJoinCode(open.joinCode!)).toBe(open.inviteCode);
    const joined = await service.join('bob', open.inviteCode);
    expect(joined.joinCode).toBeNull(); // code retired once someone joins
    await expect(service.inviteForJoinCode(open.joinCode!)).rejects.toThrow(/No open challenge/);
    void matches;

    const direct = await service.create('alice', {
      gameId: 'connect4',
      stake: 700,
      opponentId: 'bob',
    });
    expect(direct).toMatchObject({ status: 'NEGOTIATING', opponent: 'bob', joinCode: null });
    expect(pushed).toEqual([
      {
        to: 'bob',
        msg: expect.objectContaining({ title: 'ALICE challenged you', url: `/m/${direct._id}` }),
      },
    ]);
    await expect(
      service.create('alice', { gameId: 'tictactoe', stake: 500, opponentId: 'carol' }),
    ).rejects.toThrow(/Send a link instead/);
    service.stop();
  });
});

describe('web push notifier', () => {
  it('sends to every subscription and drops dead ones', async () => {
    const repo = new MemoryPushRepo();
    const sub = (n: string) => ({
      endpoint: `https://push.example/${n}`,
      keys: { p256dh: 'p', auth: 'a' },
    });
    await repo.add('bob', sub('1'));
    await repo.add('bob', sub('2'));
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith('2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return {} as never;
    });
    const n = webPushNotifier({
      repo,
      publicKey: 'pk',
      privateKey: 'sk',
      subject: 'mailto:x@y.z',
      send: send as never,
    });
    await n.notify('bob', { title: 't', body: 'b', url: '/' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await repo.listFor('bob')).toEqual([sub('1')]);
  });
});

describe('wallet activity', () => {
  it('names the opponent and game for stakes, winnings and refunds, plus the bonus', () => {
    const won: MatchDoc = {
      ...newDoc({ mode: 'escrow', challenger: 'me' }),
      opponent: 'maya',
      deposits: { me: { invoice: 'i', paymentId: 'p', paidAt: 10 } },
      result: { status: 'win', winner: 'me', reason: 'normal' },
      payouts: {
        'payout:me': {
          player: 'me',
          kind: 'payout',
          amount: 4000,
          status: 'paid',
          paymentId: 'x',
          paidAt: 20,
          attempts: 0,
          lastError: null,
        },
      },
    };
    const refunded: MatchDoc = {
      ...newDoc({ id: 'm2', mode: 'escrow', challenger: 'me' }),
      opponent: 'dev',
      deposits: { me: { invoice: 'j', paymentId: 'q', paidAt: 30 } },
      payouts: {
        'refund:me': {
          player: 'me',
          kind: 'refund',
          amount: 2000,
          status: 'pending',
          paymentId: null,
          attempts: 0,
          lastError: null,
        },
      },
    };
    const items = activityFor('me', [won, refunded], new Map([['maya', 'Maya']]), {
      paidAt: 5,
      amount: 10_000,
    });
    expect(items.map((i) => i.kind)).toEqual(['refund', 'stake', 'winnings', 'stake', 'bonus']);
    expect(items[1]).toMatchObject({ kind: 'stake', at: 30 });
    expect(items.find((i) => i.kind === 'winnings')).toMatchObject({
      gameId: 'tictactoe',
      opponent: 'Maya',
      at: 20,
    });
    // The pending refund sorts by the match's updatedAt (no paidAt yet).
    expect(activityFor('me', [refunded], new Map(), { paidAt: null, amount: 0 })).toContainEqual(
      expect.objectContaining({ kind: 'refund', opponent: 'Player', status: 'pending' }),
    );
    expect(items.at(-1)).toMatchObject({ kind: 'bonus', amount: 10_000 });
    expect(activityFor('me', [newDoc()], new Map(), { paidAt: null, amount: 1 })).toEqual([]);
  });
});
