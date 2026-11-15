import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import type { ServerConfig } from './config.js';

export interface App {
  http: HttpServer;
  io: SocketServer;
}

export function createApp(config: ServerConfig): App {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, network: config.NETWORK });
  });

  const http = createServer(app);
  const io = new SocketServer(http, {
    cors: { origin: config.PUBLIC_WEB_ORIGIN },
  });

  return { http, io };
}
