/**
 * End-to-end server test: real Express + Socket.IO server, real MongoDB (mongodb-memory-server),
 * two simulated players with mock Spark wallets. Exercises the full HTTP + socket protocol and
 * checks the actual money movement of the HTLC "oracle" escrow (ADR 0002).
 */
import type { AddressInfo } from 'node:net';
import { signedMessages } from '@coinclash/rail';
import { MockNetwork, type MockWallet } from '@coinclash/rail/mock';
import type { Ack, CodeRelease, MatchView } from '@coinclash/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { connectMongo, type MongoRepos } from '../src/db/mongo.js';

const json = async <T>(res: Promise<Response>): Promise<T> => (await (await res).json()) as T;

let mongod: MongoMemoryServer;
let repos: MongoRepos;
let chainTime = 2_000_000_000; // mock Spark clock, Unix seconds
const net = new MockNetwork(() => chainTime);

class SimPlayer {
  socket!: Socket;
  latest = new Map<string, MatchView>();
  codes: CodeRelease[] = [];
  readonly wallet: MockWallet;

  constructor(
    private readonly baseUrl: string,
    readonly id: string,
    private readonly nickname?: string,
  ) {
    this.wallet = net.wallet(id, 10_000);
  }

  async login(): Promise<void> {
    const { nonce } = await json<{ nonce: string }>(
      fetch(`${this.baseUrl}/api/auth/nonce`, { method: 'POST' }),
    );
    const signed = await this.wallet.signMessage(signedMessages.login(nonce));
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nonce,
        signed,
        nickname: this.nickname,
        sparkAddress: await this.wallet.sparkAddress(),
      }),
    });
    const { token } = (await res.json()) as { token: string };
    this.socket = connectClient(this.baseUrl, { transports: ['websocket'], auth: { token } });
    this.socket.on('match:update', (v: MatchView) => this.latest.set(v.id, v));
    this.socket.on('match:code', (c: CodeRelease) => this.codes.push(c));
    await new Promise<void>((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);
    });
  }

  async send<T = MatchView>(event: string, payload: unknown): Promise<T> {
    const ack = (await this.socket.emitWithAck(event, payload)) as Ack<T>;
    if (!ack.ok) throw new Error(ack.error);
    return ack.data;
  }

  async waitFor(matchId: string, pred: (v: MatchView) => boolean, ms = 3000): Promise<MatchView> {
    const start = Date.now();
    for (;;) {
      const v = this.latest.get(matchId);
      if (v && pred(v)) return v;
      if (Date.now() - start > ms)
        throw new Error(`${this.id}: timed out waiting on ${matchId} (${v?.status})`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Lock my stake to my opponent, wait for theirs to me, then sign that I saw it. */
  async lockAndConfirm(view: MatchView): Promise<void> {
    const locks = view.locks!;
    await this.wallet.lock({
      to: locks.opponentSparkAddress,
      amount: view.stake,
      paymentHash: locks.lockToHash,
      expirySecs: locks.htlcExpiresAt - chainTime,
    });
    let incoming = await this.wallet.findIncomingLock(locks.incomingHash);
    for (let i = 0; !incoming && i < 200; i++) {
      await new Promise((r) => setTimeout(r, 10));
      incoming = await this.wallet.findIncomingLock(locks.incomingHash);
    }
    expect(incoming).toMatchObject({ amount: view.stake, status: 'waiting' });
    expect(incoming!.expiresAt).toBeGreaterThanOrEqual(locks.htlcExpiresAt);
    const signed = await this.wallet.signMessage(
      signedMessages.lockSeen(view.id, locks.incomingHash, view.stake),
    );
    await this.send('match:lockSeen', { matchId: view.id, paymentId: incoming!.paymentId, signed });
  }

  async claim(release: CodeRelease): Promise<void> {
    await this.wallet.claim(release.preimage);
    const signed = await this.wallet.signMessage(
      signedMessages.claimed(release.matchId, release.paymentHash),
    );
    await this.send('match:claimed', { matchId: release.matchId, signed });
  }

  close() {
    this.socket?.close();
  }
}

async function startApp(): Promise<{ app: App; baseUrl: string }> {
  const app = createApp(loadConfig({ NETWORK: 'mock', PORT: '0', ESCROW_MODE: 'htlc' }), {
    matches: repos.matches,
    users: repos.users,
    clock: () => chainTime * 1000,
  });
  await app.service.reconcile();
  await new Promise<void>((resolve) => app.http.listen(0, resolve));
  const { port } = app.http.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  repos = await connectMongo(mongod.getUri(), 'coinclash-test');
}, 120_000);

afterAll(async () => {
  await repos?.client.close();
  await mongod?.stop();
});

describe('full match over sockets with mock wallets and MongoDB', () => {
  it('challenge → negotiate → lock → play → winner claims → settled; money moves correctly', async () => {
    const { app, baseUrl } = await startApp();
    const alice = new SimPlayer(baseUrl, 'alice-pk', 'Alice');
    const bob = new SimPlayer(baseUrl, 'bob-pk', 'Bob');
    try {
      await alice.login();
      await bob.login();

      const created = await alice.send('match:create', { gameId: 'tictactoe', stake: 2000 });
      expect(created.status).toBe('PROPOSED');

      const preview = await (await fetch(`${baseUrl}/api/invites/${created.inviteCode}`)).json();
      expect(preview).toEqual({
        gameId: 'tictactoe',
        gameName: 'Tic-tac-toe',
        stake: 2000,
        status: 'PROPOSED',
        challenger: 'Alice',
      });

      const joined = await bob.send('match:join', { inviteCode: created.inviteCode });
      expect(joined).toMatchObject({ status: 'NEGOTIATING', respondent: 'bob-pk' });
      await bob.send('match:counter', { matchId: created.id, amount: 1000 });
      await expect(bob.send('match:accept', { matchId: created.id })).rejects.toThrow(
        /other player/,
      );
      await expect(alice.send('match:counter', { matchId: created.id, amount: 1 })).rejects.toThrow(
        /between/,
      );
      await expect(alice.send('match:counter', { matchId: 'x', amount: 'lots' })).rejects.toThrow(
        /Invalid request/,
      );
      const agreed = await alice.send('match:takeLower', { matchId: created.id });
      expect(agreed).toMatchObject({ status: 'AWAITING_LOCKS', stake: 1000 });

      const [av, bv] = await Promise.all([
        alice.waitFor(created.id, (v) => v.status === 'AWAITING_LOCKS'),
        bob.waitFor(created.id, (v) => v.status === 'AWAITING_LOCKS'),
      ]);
      expect(av.locks!.lockToHash).toBe(bv.locks!.incomingHash);
      expect(av.locks!.opponentSparkAddress).toBe('bob-pk');

      await Promise.all([alice.lockAndConfirm(av), bob.lockAndConfirm(bv)]);
      const started = await alice.waitFor(created.id, (v) => v.status === 'IN_PROGRESS');
      expect(net.balanceOf('alice-pk')).toBe(9000);
      expect(net.balanceOf('bob-pk')).toBe(9000);

      // Play: whoever moves first wins down the top row.
      const players = { 'alice-pk': alice, 'bob-pk': bob } as Record<string, SimPlayer>;
      let view = started;
      for (const cell of [0, 3, 1, 4, 2]) {
        const mover = players[view.game!.waitingOn[0]!]!;
        view = await mover.send('match:move', { matchId: created.id, move: { cell } });
      }
      expect(view.status).toBe('SETTLING');
      const winnerId = (view.game!.result as { winner: string }).winner;
      const winner = players[winnerId]!;
      const loser = players[winnerId === 'alice-pk' ? 'bob-pk' : 'alice-pk']!;

      // Only the winner gets a code.
      await winner.waitFor(created.id, (v) => v.status === 'SETTLING');
      expect(winner.codes).toHaveLength(1);
      expect(loser.codes).toHaveLength(0);
      await expect(loser.wallet.claim(winner.codes[0]!.preimage)).rejects.toThrow();

      await winner.claim(winner.codes[0]!);
      await winner.waitFor(created.id, (v) => v.status === 'SETTLED');
      // Winner: +1000 from the loser's lock now; own 1000 still locked until expiry.
      expect(net.balanceOf(winner.id)).toBe(10_000);
      expect(net.balanceOf(loser.id)).toBe(9000);
      chainTime = view.locks!.htlcExpiresAt + 1;
      expect(net.balanceOf(winner.id)).toBe(11_000);
      expect(net.balanceOf(loser.id)).toBe(9000);

      // History endpoint and rematch.
      const token = app.auth.sign(winner.id);
      const list = await json<MatchView[]>(
        fetch(`${baseUrl}/api/matches`, { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(list[0]).toMatchObject({ id: created.id, status: 'SETTLED' });
      const me = await (
        await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${token}` } })
      ).json();
      expect(me).toEqual({ id: winner.id, nickname: winner === alice ? 'Alice' : 'Bob' });
      const friends = await json<{ nickname: string; gamesPlayed: number; streakDays: number }[]>(
        fetch(`${baseUrl}/api/friends?tzOffset=0`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(friends).toEqual([
        expect.objectContaining({
          nickname: winner === alice ? 'Bob' : 'Alice',
          gamesPlayed: 1,
          streakDays: 1,
          record: { wins: 1, losses: 0, draws: 0 },
        }),
      ]);
      const rematch = await loser.send('match:rematch', { matchId: created.id });
      expect(rematch).toMatchObject({ status: 'NEGOTIATING', stake: 1000, rematchOf: created.id });
    } finally {
      alice.close();
      bob.close();
      await app.close();
    }
  }, 30_000);

  it('survives a server restart mid-settlement: code is re-sent on reconnect', async () => {
    const first = await startApp();
    const carol = new SimPlayer(first.baseUrl, 'carol-pk', 'Carol');
    const dave = new SimPlayer(first.baseUrl, 'dave-pk', 'Dave');
    await carol.login();
    await dave.login();
    const created = await carol.send('match:create', { gameId: 'tictactoe', stake: 500 });
    await dave.send('match:join', { inviteCode: created.inviteCode });
    await dave.send('match:accept', { matchId: created.id });
    const [cv, dv] = await Promise.all([
      carol.waitFor(created.id, (v) => v.status === 'AWAITING_LOCKS'),
      dave.waitFor(created.id, (v) => v.status === 'AWAITING_LOCKS'),
    ]);
    await Promise.all([carol.lockAndConfirm(cv), dave.lockAndConfirm(dv)]);
    const started = await carol.waitFor(created.id, (v) => v.status === 'IN_PROGRESS');
    const loserId = started.game!.waitingOn[0]!;
    const loser = loserId === 'carol-pk' ? carol : dave;
    await loser.send('match:resign', { matchId: created.id });
    const winner = loser === carol ? dave : carol;
    await winner.waitFor(created.id, (v) => v.status === 'SETTLING');
    expect(winner.codes).toHaveLength(1);

    // Crash before the winner claims.
    carol.close();
    dave.close();
    await first.app.close();

    const second = await startApp();
    const again = new SimPlayer(second.baseUrl, winner.id); // returning user: no nickname
    try {
      await again.login();
      for (let i = 0; again.codes.length === 0 && i < 200; i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(again.codes[0]).toEqual(winner.codes[0]);
      await again.claim(again.codes[0]!);
      const view = await again.send('match:subscribe', { matchId: created.id });
      expect(view.status).toBe('SETTLED');
      expect(view.challenger.nickname).toBe('Carol');
    } finally {
      again.close();
      await second.app.close();
    }
  }, 30_000);
});
