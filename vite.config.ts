import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['fav.svg', 'logo.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'SmartRecall',
        short_name: 'SmartRecall',
        description: 'Private, offline-first flashcards and spaced repetition study',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f8fa',
        theme_color: '#315b47',
        lang: 'en',
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Activate updates only after the learner accepts the update prompt.
        skipWaiting: false,
        clientsClaim: false,
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 4000,
    strictPort: true,
  },
});
