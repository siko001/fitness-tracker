import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { foodSearch } from './server/food-search.mjs';

export default defineConfig({
  plugins: [react(), { name: 'food-search-dev', configureServer(server) { server.middlewares.use('/api/food-search', async (req, res) => { if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; } const result = await foodSearch(new URL(req.url || '/', 'http://localhost').searchParams); res.statusCode = result.status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result.body)); }); } }, VitePWA({
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
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json}'], navigateFallbackDenylist: [/^\/privacypolicy\.html$/, /^\/api\//] },
  })],
});
