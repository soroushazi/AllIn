import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    port: 5173,
    // Bind to all interfaces, not just localhost - required for Codespaces/
    // container port forwarding to reach the dev server at all.
    host: true,
    // Proxy API calls through the dev server itself so the browser only ever
    // talks to one origin. Needed for GitHub Codespaces: each forwarded port
    // gets its own subdomain, which browsers treat as a different site, so a
    // direct cross-origin fetch to the backend silently drops the session
    // cookie (SameSite=Lax cookies aren't sent on cross-site requests).
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'AllIn - Household Expenses',
        short_name: 'AllIn',
        description: 'Shared household expense tracker',
        theme_color: '#16a34a',
        background_color: '#0b0f0d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
