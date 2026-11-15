import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: App;
let base: string;

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'cc-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>CoinClash</title>');
  writeFileSync(join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
  writeFileSync(join(dist, 'assets', 'x.wasm'), Buffer.from([0, 97, 115, 109]));
  app = createApp(loadConfig({ NETWORK: 'mock', PORT: '0', WEB_DIST_DIR: dist }));
  await new Promise<void>((r) => app.http.listen(0, r));
  base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

it('serves the SPA with fallback, immutable assets and wasm MIME, without shadowing the API', async () => {
  const deep = await fetch(`${base}/m/some-match`);
  expect(deep.status).toBe(200);
  expect(deep.headers.get('cache-control')).toBe('no-cache');
  expect(await deep.text()).toContain('CoinClash');
  const asset = await fetch(`${base}/assets/app-abc.js`);
  expect(asset.headers.get('cache-control')).toContain('immutable');
  const wasm = await fetch(`${base}/assets/x.wasm`);
  expect(wasm.headers.get('content-type')).toBe('application/wasm');
  expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ ok: true });
  expect((await fetch(`${base}/api/nope`)).status).toBe(404);
});
