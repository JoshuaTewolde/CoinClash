import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('server basics', () => {
  let app: App;
  let baseUrl: string;

  beforeAll(async () => {
    app = createApp(loadConfig({ NETWORK: 'mock', PORT: '0' }));
    await new Promise<void>((resolve) => app.http.listen(0, resolve));
    const { port } = app.http.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers /health and /api/config', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, network: 'mock' });
    const cfg = (await (await fetch(`${baseUrl}/api/config`)).json()) as { games: unknown };
    expect(cfg).toMatchObject({
      network: 'mock',
      networks: ['mock'],
      stakeMin: 100,
      stakeMax: 100000,
    });
    expect(cfg.games).toContainEqual({
      id: 'tictactoe',
      name: 'Tic-tac-toe',
      turnModel: 'alternating',
    });
    expect(cfg.games).toContainEqual({
      id: 'rps',
      name: 'Rock Paper Scissors',
      turnModel: 'simultaneous',
    });
  });

  it('rejects sockets without a valid token and accepts signed-in ones', async () => {
    const anon = connectClient(baseUrl, { transports: ['websocket'], reconnection: false });
    const error = await new Promise<Error>((resolve) => anon.on('connect_error', resolve));
    expect(error.message).toBe('Not signed in');
    anon.close();

    const client = connectClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: app.auth.sign('alice') },
    });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });
    expect(client.connected).toBe(true);
    client.close();
  });

  it('protects authenticated routes', async () => {
    expect((await fetch(`${baseUrl}/api/me`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/invites/nope`)).status).toBe(404);
  });
});

describe('config', () => {
  it('rejects invalid values', () => {
    expect(() => loadConfig({ NETWORK: 'testnet' })).toThrow(/Invalid server configuration/);
    expect(() => loadConfig({ NETWORK: 'regtest' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NETWORK: 'mock', SESSION_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() =>
      loadConfig({ NETWORK: 'mock', STAKE_MIN_SATS: '500', STAKE_MAX_SATS: '100' }),
    ).toThrow(/STAKE_MIN_SATS/);
  });

  it('uses a dev secret only in mock mode', () => {
    expect(loadConfig({ NETWORK: 'mock' }).SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    const secret = 'x'.repeat(40);
    expect(loadConfig({ NETWORK: 'regtest', SESSION_SECRET: secret }).SESSION_SECRET).toBe(secret);
  });
});
