/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Same origin in dev and prod: the API and Socket.IO sit behind /api and /socket.io
// (Vite proxies them here; Caddy does in production, ADR 0004).
const server = process.env.COINCLASH_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    // Installable PWA (spec §10): app shell offline; API, Socket.IO and health never cached.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CoinClash',
        short_name: 'CoinClash',
        description: 'Play your friends for sats.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFF8EC',
        theme_color: '#FFF8EC',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/health$/],
        // The Breez WASM (~13 MB) is too big to precache; cache it on first use instead.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'breez-wasm', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
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
