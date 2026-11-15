import { signedMessages } from '@coinclash/rail';
import { MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import type { CodeRelease } from '@coinclash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryMatchRepo, MemoryUserRepo } from '../src/db/repos.js';
import { games } from '../src/games.js';
import { MatchService } from '../src/match/service.js';
import type { MatchDoc } from '../src/match/types.js';
import { CONFIG, T0, toMove } from './helpers.js';

function setup(matches = new MemoryMatchRepo(), users = new MemoryUserRepo()) {
  const changed = vi.fn<(doc: MatchDoc) => void>();
  const codes: { player: string; release: CodeRelease }[] = [];
  const service = new MatchService({
    matches,
    users,
    plugins: games,
    verifier: mockVerifier,
    config: CONFIG,
    events: { changed, codeReleased: (player, release) => codes.push({ player, release }) },
  });
  return { service, matches, users, changed, codes };
}

const net = new MockNetwork();
const alice = net.wallet('alice');
const bob = net.wallet('bob');
const wallets = { alice, bob } as const;

async function lockedMatch(service: MatchService) {
  const created = await service.create('alice', { gameId: 'tictactoe', stake: 2000 });
  await service.join('bob', created.inviteCode);
  await service.command(created._id, { type: 'accept', player: 'bob' });
  let doc = await service.get(created._id);
  for (const p of ['alice', 'bob'] as const) {
    const signed = await wallets[p].signMessage(
      signedMessages.lockSeen(doc._id, doc.secrets![p]!.hash, doc.stake),
    );
    doc = await service.lockSeen(p, { matchId: doc._id, paymentId: `pay-${p}`, signed });
  }
  return doc;
}

async function playWin(service: MatchService, doc: MatchDoc) {
  let cur = doc;
  for (const cell of [0, 3, 1, 4, 2]) {
    cur = await service.command(cur._id, { type: 'move', player: toMove(cur), move: { cell } });
  }
  return cur;
}

describe('MatchService', () => {
  let svc: ReturnType<typeof setup>;
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    svc = setup();
  });
  afterEach(() => {
    svc.service.stop();
    vi.useRealTimers();
  });

  it('creates matches with validated stakes, games and options', async () => {
    const { service } = svc;
    const doc = await service.create('alice', { gameId: 'tictactoe', stake: 2000 });
    expect(doc.status).toBe('PROPOSED');
    expect(doc.inviteCode).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(doc.seed).toMatch(/^[0-9a-f]{32}$/);
    await expect(service.create('alice', { gameId: 'chess', stake: 2000 })).rejects.toThrow(
      /Unknown game/,
    );
    await expect(service.create('alice', { gameId: 'tictactoe', stake: 5 })).rejects.toThrow(
      /Stake/,
    );
    await expect(
      service.create('alice', { gameId: 'tictactoe', stake: 2000, options: { x: 1 } }),
    ).rejects.toThrow(/no options/);
    await expect(service.join('bob', 'missing')).rejects.toThrow(/Invite not found/);
    await expect(service.get('missing')).rejects.toThrow(/not found/);
    expect(svc.changed).toHaveBeenCalled();
  });

  it('generates distinct random secrets and never repeats invite codes', async () => {
    const a = await lockedMatch(svc.service);
    const b = await lockedMatch(svc.service);
    expect(a.secrets!.alice!.preimage).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Set([a, b].flatMap((d) => Object.values(d.secrets!).map((s) => s.preimage))).size,
    ).toBe(4);
    expect(a.inviteCode).not.toBe(b.inviteCode);
  });

  it('only accepts lock confirmations signed by the receiving wallet for this match', async () => {
    const { service } = svc;
    const created = await service.create('alice', { gameId: 'tictactoe', stake: 2000 });
    await expect(
      service.lockSeen('alice', {
        matchId: created._id,
        paymentId: 'p',
        signed: await alice.signMessage('x'),
      }),
    ).rejects.toThrow(/not waiting for locks/);
    await service.join('bob', created.inviteCode);
    const doc = await service.command(created._id, { type: 'accept', player: 'bob' });
    const right = signedMessages.lockSeen(doc._id, doc.secrets!.alice!.hash, doc.stake);
    // wrong amount
    const wrongAmount = await alice.signMessage(
      signedMessages.lockSeen(doc._id, doc.secrets!.alice!.hash, 1),
    );
    await expect(
      service.lockSeen('alice', { matchId: doc._id, paymentId: 'p', signed: wrongAmount }),
    ).rejects.toThrow(/does not match/);
    // signed by someone else
    const byBob = await bob.signMessage(right);
    await expect(
      service.lockSeen('alice', { matchId: doc._id, paymentId: 'p', signed: byBob }),
    ).rejects.toThrow(/does not match/);
    // forged signature
    await expect(
      service.lockSeen('alice', {
        matchId: doc._id,
        paymentId: 'p',
        signed: { message: right, pubkey: 'alice', signature: 'mocksig:forged' },
      }),
    ).rejects.toThrow(/Invalid signature/);
    const ok = await service.lockSeen('alice', {
      matchId: doc._id,
      paymentId: 'p',
      signed: await alice.signMessage(right),
    });
    expect(ok.lockSeenBy.alice?.paymentId).toBe('p');
  });

  it('cancels when the lock window passes (timer)', async () => {
    const { service } = svc;
    const created = await service.create('alice', { gameId: 'tictactoe', stake: 2000 });
    await service.join('bob', created.inviteCode);
    await service.command(created._id, { type: 'accept', player: 'bob' });
    await vi.advanceTimersByTimeAsync(CONFIG.lockTimeoutMs + 10);
    expect((await service.get(created._id)).status).toBe('CANCELLED');
  });

  it('forfeits on the turn timer', async () => {
    const doc = await lockedMatch(svc.service);
    const x = toMove(doc);
    await vi.advanceTimersByTimeAsync(60_000 + 10);
    const after = await svc.service.get(doc._id);
    expect(after.status).toBe('SETTLING');
    expect(after.result).toMatchObject({ reason: 'timeout' });
    expect(after.released).not.toContain(x);
  });

  it('releases the winner code privately and settles on a signed claim', async () => {
    const { service, codes } = svc;
    const won = await playWin(service, await lockedMatch(service));
    const winner = won.released[0]!;
    expect(codes).toEqual([
      {
        player: winner,
        release: {
          matchId: won._id,
          preimage: won.secrets![winner]!.preimage,
          paymentHash: won.secrets![winner]!.hash,
        },
      },
    ]);
    const loser = winner === 'alice' ? 'bob' : 'alice';
    const wallet = wallets[winner as 'alice' | 'bob'];
    await expect(
      service.claimed(loser, {
        matchId: won._id,
        signed: await wallets[loser].signMessage(
          signedMessages.claimed(won._id, won.secrets![loser]!.hash),
        ),
      }),
    ).rejects.toThrow(/No winnings/);
    await expect(
      service.claimed(winner, { matchId: won._id, signed: await wallet.signMessage('nope') }),
    ).rejects.toThrow(/does not match/);
    const settled = await service.claimed(winner, {
      matchId: won._id,
      signed: await wallet.signMessage(signedMessages.claimed(won._id, won.secrets![winner]!.hash)),
    });
    expect(settled.status).toBe('SETTLED');
  });

  it('re-sends unclaimed codes when the winner reconnects, and handles presence', async () => {
    const { service, codes } = svc;
    const won = await playWin(service, await lockedMatch(service));
    const winner = won.released[0]!;
    codes.length = 0;
    await service.onConnect(winner);
    expect(codes).toHaveLength(1);
    expect(codes[0]?.player).toBe(winner);
    await service.onConnect(winner === 'alice' ? 'bob' : 'alice');
    expect(codes).toHaveLength(1);
  });

  it('disconnect grace forfeits the absent player; reconnecting in time saves them', async () => {
    const { service } = svc;
    const doc = await lockedMatch(service);
    await service.onDisconnect('bob');
    await vi.advanceTimersByTimeAsync(30_000);
    await service.onConnect('bob');
    expect((await service.get(doc._id)).graceEndsAt).toEqual({});

    const doc2 = await lockedMatch(service);
    // Make the absent player not the one on move so the turn timer isn't what ends it.
    const absent = toMove(doc2) === 'alice' ? 'bob' : 'alice';
    await service.command(doc2._id, { type: 'move', player: toMove(doc2), move: { cell: 4 } });
    await service.onDisconnect(absent);
    await vi.advanceTimersByTimeAsync(CONFIG.disconnectGraceMs + 10);
    const after = await service.get(doc2._id);
    expect(after.result).toMatchObject({
      status: 'win',
      reason: expect.stringMatching(/forfeit|timeout/),
    });
    expect(after.released).not.toContain(absent);
  });

  it('reconciles after a crash: processes missed deadlines and re-arms timers', async () => {
    const matches = new MemoryMatchRepo();
    const users = new MemoryUserRepo();
    const first = setup(matches, users);
    const doc = await lockedMatch(first.service);
    const created = await first.service.create('alice', { gameId: 'tictactoe', stake: 500 });
    await first.service.join('bob', created.inviteCode);
    await first.service.command(created._id, { type: 'accept', player: 'bob' });
    // Crash: timers gone.
    first.service.stop();
    vi.setSystemTime(T0 + CONFIG.lockTimeoutMs + 1);

    const second = setup(matches, users);
    expect(await second.service.reconcile()).toBe(2);
    // Lock window passed while down → cancelled immediately.
    expect((await second.service.get(created._id)).status).toBe('CANCELLED');
    // In-progress game's turn timer had passed too → forfeited by timeout.
    expect((await second.service.get(doc._id)).status).toBe('SETTLING');
    // And its claim deadline timer is armed again.
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect((await second.service.get(doc._id)).status).toBe('EXPIRED');
    second.service.stop();
  });

  it('ignores presence changes after stop (server shutdown must not forfeit games)', async () => {
    const { service } = svc;
    const doc = await lockedMatch(service);
    service.stop();
    await service.onDisconnect('alice');
    await service.onConnect('alice');
    expect((await service.get(doc._id)).graceEndsAt).toEqual({});
  });

  it('rematch creates a linked match with the same game and stake', async () => {
    const { service } = svc;
    const won = await playWin(service, await lockedMatch(service));
    await expect(service.rematch('eve', won._id)).rejects.toThrow(/not in this match/);
    const fresh = await service.rematch('bob', won._id);
    expect(fresh).toMatchObject({
      status: 'NEGOTIATING',
      challenger: 'bob',
      opponent: 'alice',
      stake: 2000,
      rematchOf: won._id,
    });
    expect((await service.get(won._id)).rematchId).toBe(fresh._id);
    expect((await service.rematch('alice', won._id))._id).toBe(fresh._id);
    const pending = await service.create('alice', { gameId: 'tictactoe', stake: 2000 });
    await expect(service.rematch('alice', pending._id)).rejects.toThrow(/no result/);
  });

  it('serializes concurrent commands on one match', async () => {
    const { service } = svc;
    const doc = await lockedMatch(service);
    const player = toMove(doc);
    const results = await Promise.allSettled([
      service.command(doc._id, { type: 'move', player, move: { cell: 0 } }),
      service.command(doc._id, { type: 'move', player, move: { cell: 1 } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const after = await service.get(doc._id);
    expect(after.session!.events).toHaveLength(1);
    expect(after.version).toBe(doc.version + 1);
  });

  it('builds per-player views without secrets', async () => {
    const { service, users } = svc;
    await users.upsert({
      _id: 'alice',
      nickname: 'Alice',
      sparkAddress: 'sp-alice',
      createdAt: 0,
      lastLoginAt: 0,
      bonusPaidAt: null,
    });
    await users.upsert({
      _id: 'bob',
      nickname: 'Bob',
      sparkAddress: 'sp-bob',
      createdAt: 0,
      lastLoginAt: 0,
      bonusPaidAt: null,
    });
    const doc = await lockedMatch(service);
    const view = await service.view(doc, 'alice');
    expect(view.you).toBe('alice');
    expect(view.locks).toMatchObject({
      lockToHash: doc.secrets!.bob!.hash,
      incomingHash: doc.secrets!.alice!.hash,
      opponentSparkAddress: 'sp-bob',
      locked: { alice: true, bob: true },
    });
    expect(JSON.stringify(view)).not.toContain(doc.secrets!.alice!.preimage);
    expect(JSON.stringify(view)).not.toContain(doc.secrets!.bob!.preimage);
    const outsider = await service.view(doc, 'eve');
    expect(outsider.you).toBeNull();
    expect(outsider.locks).toBeNull();
    expect((await service.listFor('alice')).length).toBe(1);
  });
});
