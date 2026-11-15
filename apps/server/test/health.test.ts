import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('server skeleton', () => {
  let app: App;
  let baseUrl: string;

  beforeAll(async () => {
    app = createApp(loadConfig({ NETWORK: 'mock', PORT: '0' }));
    await new Promise<void>((resolve) => app.http.listen(0, resolve));
    const { port } = app.http.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.io.close();
  });

  it('answers /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, network: 'mock' });
  });

  it('accepts socket.io connections', async () => {
    const client = connectClient(baseUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });
    expect(client.connected).toBe(true);
    client.close();
  });

  it('rejects invalid config', () => {
    expect(() => loadConfig({ NETWORK: 'testnet' })).toThrow(/Invalid server configuration/);
  });
});
