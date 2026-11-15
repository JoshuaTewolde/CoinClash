/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same origin in dev and prod: the API and Socket.IO sit behind /api and /socket.io
// (Vite proxies them here; Caddy does in production, ADR 0004).
const server = process.env.COINCLASH_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  // The Breez SDK loads its WASM via a URL relative to its own module. Vite's dependency
  // pre-bundling moves the module and breaks that URL in dev, so serve it as-is.
  optimizeDeps: { exclude: ['@breeztech/breez-sdk-spark'] },
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/socket.io': { target: server, ws: true },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
