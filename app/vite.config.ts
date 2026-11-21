import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` lets the same build run from GitHub Pages (/misfacturas/) or a domain root.
export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Mis Facturas',
        short_name: 'Facturas',
        lang: 'es-DO',
        display: 'standalone',
        background_color: '#eceded',
        theme_color: '#ff5a1f',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. API calls go to script.google.com and are never cached (the outbox handles offline).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
