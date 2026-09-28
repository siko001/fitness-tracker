import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'privacypolicy.html'],
    manifest: {
      name: 'Steady — food & fitness', short_name: 'Steady',
      description: 'Your food, movement and progress, even offline.',
      theme_color: '#214d3b', background_color: '#f5f6f2',
      display: 'standalone', start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json}'], navigateFallbackDenylist: [/^\/privacypolicy\.html$/] },
  })],
});
