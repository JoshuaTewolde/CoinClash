import { createServer, type Server as HttpServer } from 'node:http';
import type { AnyGamePlugin } from '@coinclash/game-sdk';
import type { SignatureVerifier } from '@coinclash/rail';
import { mockVerifier } from '@coinclash/rail/mock';
import {
  ClientCommands,
  LoginRequestSchema,
  type Ack,
  type ClientCommandName,
  type ServerEvents,
} from '@coinclash/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server as SocketServer, type Socket } from 'socket.io';
import { ZodError, type z } from 'zod';
import { Auth, AuthError } from './auth.js';
import type { ServerConfig } from './config.js';
import { MemoryMatchRepo, MemoryUserRepo, type MatchRepo, type UserRepo } from './db/repos.js';
import { games as defaultGames } from './games.js';
import { MatchError } from './match/machine.js';
import { MatchService } from './match/service.js';
import { playersOf } from './match/types.js';

export interface AppDeps {
  matches?: MatchRepo;
  users?: UserRepo;
  verifier?: SignatureVerifier;
  plugins?: ReadonlyMap<string, AnyGamePlugin>;
  /** Unix ms. */
  clock?: () => number;
}

export interface App {
  http: HttpServer;
  io: SocketServer;
  service: MatchService;
  auth: Auth;
  close(): Promise<void>;
}

/** Rejects everything: used until the Breez verifier lands (Phase 5) outside mock mode. */
const unavailableVerifier: SignatureVerifier = { verify: async () => false };

function userMessage(err: unknown): string {
  if (err instanceof MatchError || err instanceof AuthError) return err.message;
  if (err instanceof ZodError)
    return `Invalid request: ${err.issues.map((i) => i.message).join(', ')}`;
  console.error('[coinclash] unexpected error', err);
  return 'Something went wrong';
}

export function createApp(config: ServerConfig, deps: AppDeps = {}): App {
  const matches = deps.matches ?? new MemoryMatchRepo();
  const users = deps.users ?? new MemoryUserRepo();
  const plugins = deps.plugins ?? defaultGames;
  const clock = deps.clock ?? Date.now;
  const verifier =
    deps.verifier ?? (config.NETWORK === 'mock' ? mockVerifier : unavailableVerifier);

  const auth = new Auth({
    secret: config.SESSION_SECRET,
    ttlSeconds: config.SESSION_TTL_SECONDS,
    verifier,
    users,
    clock,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  const http = createServer(app);
  const io = new SocketServer<Record<string, never>, ServerEvents>(http, {
    cors: { origin: config.PUBLIC_WEB_ORIGIN },
  });

  const service = new MatchService({
    matches,
    users,
    plugins,
    verifier,
    clock,
    config: {
      stakeMin: config.STAKE_MIN_SATS,
      stakeMax: config.STAKE_MAX_SATS,
      lockTimeoutMs: config.LOCK_TIMEOUT_SECONDS * 1000,
      claimWindowSeconds: config.CLAIM_WINDOW_SECONDS,
      disconnectGraceMs: config.DISCONNECT_GRACE_SECONDS * 1000,
    },
    events: {
      changed: (doc) => {
        for (const p of playersOf(doc)) {
          service
            .view(doc, p)
            .then((view) => io.to(`user:${p}`).emit('match:update', view))
            .catch((err) => console.error('[coinclash] view failed', err));
        }
      },
      codeReleased: (player, release) => io.to(`user:${player}`).emit('match:code', release),
    },
  });

  // ---------- HTTP ----------
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.userId = auth.verifyToken(req.headers.authorization?.replace(/^Bearer /, ''));
      next();
    } catch (err) {
      res.status(401).json({ ok: false, error: userMessage(err) });
    }
  };

  app.get('/health', (_req, res) => {
    res.json({ ok: true, network: config.NETWORK });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      network: config.NETWORK,
      stakeMin: config.STAKE_MIN_SATS,
      stakeMax: config.STAKE_MAX_SATS,
      games: [...plugins.values()].map((g) => ({ id: g.id, name: g.name, turnModel: g.turnModel })),
    });
  });

  app.post('/api/auth/nonce', (_req, res) => {
    res.json({ nonce: auth.issueNonce() });
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { token, user } = await auth.login(LoginRequestSchema.parse(req.body));
      res.json({ token, user: { id: user._id, nickname: user.nickname } });
    } catch (err) {
      res.status(400).json({ ok: false, error: userMessage(err) });
    }
  });

  app.get('/api/me', requireUser, async (_req, res) => {
    const user = await users.get(res.locals.userId as string);
    if (!user) return void res.status(404).json({ ok: false, error: 'User not found' });
    res.json({ id: user._id, nickname: user.nickname });
  });

  app.get('/api/matches', requireUser, async (_req, res) => {
    const me = res.locals.userId as string;
    const docs = await service.listFor(me);
    res.json(await Promise.all(docs.map((d) => service.view(d, me))));
  });

  /** Public invite preview for the challenge card before sign-in. No secrets, no ids. */
  app.get('/api/invites/:code', async (req, res) => {
    const doc = await matches.getByInvite(req.params.code);
    if (!doc) return void res.status(404).json({ ok: false, error: 'Invite not found' });
    const challenger = await users.get(doc.challenger);
    res.json({
      gameId: doc.gameId,
      gameName: plugins.get(doc.gameId)?.name ?? doc.gameId,
      stake: doc.stake,
      status: doc.status,
      challenger: challenger?.nickname ?? 'A friend',
    });
  });

  // ---------- Socket.IO ----------
  const presence = new Map<string, number>();

  io.use((socket, next) => {
    try {
      socket.data.userId = auth.verifyToken(socket.handshake.auth?.token);
      next();
    } catch (err) {
      next(new Error(userMessage(err)));
    }
  });

  type Handler<N extends ClientCommandName> = (
    me: string,
    input: z.infer<(typeof ClientCommands)[N]>,
  ) => Promise<unknown>;

  const view = async (matchId: string, me: string) => service.view(await service.get(matchId), me);

  const handlers: { [N in ClientCommandName]: Handler<N> } = {
    'match:create': async (me, i) => service.view(await service.create(me, i), me),
    'match:join': async (me, i) => service.view(await service.join(me, i.inviteCode), me),
    'match:subscribe': async (me, i) => view(i.matchId, me),
    'match:accept': async (me, i) =>
      service.view(await service.command(i.matchId, { type: 'accept', player: me }), me),
    'match:counter': async (me, i) =>
      service.view(
        await service.command(i.matchId, { type: 'counter', player: me, amount: i.amount }),
        me,
      ),
    'match:takeLower': async (me, i) =>
      service.view(await service.command(i.matchId, { type: 'takeLower', player: me }), me),
    'match:decline': async (me, i) =>
      service.view(await service.command(i.matchId, { type: 'decline', player: me }), me),
    'match:lockSeen': async (me, i) => service.view(await service.lockSeen(me, i), me),
    'match:move': async (me, i) =>
      service.view(
        await service.command(i.matchId, { type: 'move', player: me, move: i.move }),
        me,
      ),
    'match:resign': async (me, i) =>
      service.view(await service.command(i.matchId, { type: 'resign', player: me }), me),
    'match:claimed': async (me, i) => service.view(await service.claimed(me, i), me),
    'match:rematch': async (me, i) => service.view(await service.rematch(me, i.matchId), me),
  };

  io.on('connection', (socket: Socket) => {
    const me = socket.data.userId as string;
    void socket.join(`user:${me}`);
    const count = (presence.get(me) ?? 0) + 1;
    presence.set(me, count);
    if (count === 1)
      service.onConnect(me).catch((err) => console.error('[coinclash] onConnect', err));

    for (const name of Object.keys(ClientCommands) as ClientCommandName[]) {
      socket.on(name, async (payload: unknown, ack?: (res: Ack<unknown>) => void) => {
        const reply = typeof ack === 'function' ? ack : () => undefined;
        try {
          const input = ClientCommands[name].parse(payload);
          const data = await (handlers[name] as Handler<typeof name>)(me, input as never);
          reply({ ok: true, data });
        } catch (err) {
          reply({ ok: false, error: userMessage(err) });
        }
      });
    }

    socket.on('disconnect', () => {
      const left = (presence.get(me) ?? 1) - 1;
      if (left <= 0) {
        presence.delete(me);
        service.onDisconnect(me).catch((err) => console.error('[coinclash] onDisconnect', err));
      } else presence.set(me, left);
    });
  });

  return {
    http,
    io,
    service,
    auth,
    close: async () => {
      service.stop();
      await io.close();
    },
  };
}
