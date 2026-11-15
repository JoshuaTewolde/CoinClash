import { MockEscrow, MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import { describe, expect, it, vi } from 'vitest';
import { MemoryMatchRepo, MemoryUserRepo } from '../src/db/repos.js';
import { games } from '../src/games.js';
import { MatchService } from '../src/match/service.js';
import { CONFIG } from './helpers.js';

describe('turn timeout with money on the line', () => {
  it.each(['tictactoe', 'connect4', 'pool', 'rps', 'trivia'])(
    '%s: the player who stops moving loses the pot',
    async (gameId) => {
      let now = 1_900_000_000_000;
      const net = new MockNetwork(() => Math.floor(now / 1000));
      const escrow = new MockEscrow(net);
      const users = new MemoryUserRepo();
      for (const id of ['alice', 'bob']) {
        net.wallet(id, 10_000);
        await users.upsert({
          _id: id,
          nickname: id,
          sparkAddress: id,
          createdAt: 0,
          lastLoginAt: 0,
          bonusPaidAt: null,
        });
      }
      const service = new MatchService({
        matches: new MemoryMatchRepo(),
        users,
        plugins: games,
        verifier: mockVerifier,
        config: CONFIG,
        escrow,
        clock: () => now,
        events: { changed: vi.fn(), codeReleased: vi.fn() },
      });
      const m = await service.create('alice', { gameId, stake: 1000 });
      await service.join('bob', m.inviteCode);
      await service.command(m._id, { type: 'accept', player: 'bob' });
      const until = async (pred: () => Promise<boolean>) => {
        for (let i = 0; i < 300 && !(await pred()); i++)
          await new Promise((r) => setTimeout(r, 10));
      };
      await until(async () => !!(await service.get(m._id)).deposits.bob?.invoice);
      const d = await service.get(m._id);
      await net.wallet('alice').payInvoice(d.deposits.alice!.invoice!, 'a');
      await net.wallet('bob').payInvoice(d.deposits.bob!.invoice!, 'b');
      await until(async () => (await service.get(m._id)).status === 'IN_PROGRESS');
      // Alice goes idle. Bob keeps playing whenever the game waits on him (simultaneous games);
      // in turn-based games Alice simply never moves on her turn.
      const bobMove = (view: unknown): unknown => {
        if (gameId === 'rps') return { pick: 'rock' };
        if (gameId === 'trivia') {
          const q = (view as { current: { index: number } | null }).current;
          return q ? { question: q.index, choice: correct(q.index) } : null;
        }
        return null; // turn-based: Bob only moves on his own turn, which never comes
      };
      // Bob plays well: in trivia he answers correctly (read from server state; never sent to clients).
      let correct = (_i: number) => 0;
      for (let i = 0; i < 80; i++) {
        const cur = await service.get(m._id);
        if (gameId === 'trivia') {
          // The bank lists the right answer first; `order` maps display slots to bank options.
          const st = cur.session!.state as { questions: { order: number[] }[] };
          correct = (qi) => st.questions[qi]!.order.indexOf(0);
        }
        if (cur.status !== 'IN_PROGRESS') break;
        const v = await service.view(cur, 'bob');
        const mv = v.game?.waitingOn.includes('bob') ? bobMove(v.game.view) : null;
        if (mv) await service.command(m._id, { type: 'move', player: 'bob', move: mv });
        now += games.get(gameId)!.defaultTurnSeconds * 1000 + 500; // the next turn deadline
        await service.command(m._id, { type: 'tick' });
      }
      await until(async () => (await service.get(m._id)).status === 'SETTLED');
      const done = await service.get(m._id);
      service.stop();
      // Whoever went idle loses the whole stake; the other player gets the pot.
      expect(done.result).toMatchObject({ status: 'win' });
      const winner = (done.result as { winner: string }).winner;
      const loser = winner === 'alice' ? 'bob' : 'alice';
      expect(net.balanceOf(winner)).toBe(11_000);
      expect(net.balanceOf(loser)).toBe(9_000);
      if (gameId === 'rps' || gameId === 'trivia') expect(winner).toBe('bob'); // Alice was idle
    },
  );
});
