import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

// `just dev-https` sets VITE_HTTPS=1 to serve over HTTPS with a self-signed certificate (iPhone testing).
const https = process.env.VITE_HTTPS === '1'

/** Runtime dependencies with their licenses, for Settings → About. */
const licenses = Object.keys(packageJson.dependencies)
  .sort()
  .map((name) => {
    const manifest = JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8'))
    return { name, version: String(manifest.version), license: String(manifest.license ?? 'unknown') }
  })

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version), __LICENSES__: JSON.stringify(licenses) },
  plugins: [
    react(),
    tailwindcss(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Annette Cards',
        short_name: 'Annette',
        description: 'Learn words from your own dictionary with spaced repetition',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 127.0.0.1, not localhost: on macOS localhost may resolve to IPv6 while the server binds IPv4
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
