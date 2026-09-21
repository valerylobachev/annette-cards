import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://localhost:5173'
/** The production build with its service worker (the dev server has none); offline.spec.ts serves it again. */
const previewURL = 'http://localhost:4173'
/**
 * Specs that talk to the server (sign-in, sync) use their own API server with a fresh database and an HTTPS dev
 * server in front of it: WebKit keeps the `Secure` session cookie only on HTTPS, even on localhost.
 * Values shared with the specs are in tests/e2e/server.ts.
 */
const syncURL = 'https://localhost:5174'
const apiPort = 8091

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    // WebKit approximates iOS Safari and is mandatory.
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm dev --port 5173 --strictPort',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      // A new database with one admin (tests/e2e/server.ts), then the debug server.
      command:
        'rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && ' +
        "printf 'admin password 1\\n' | cargo run -q -- create-user --email admin@e2e.test --name Admin --admin " +
        '--password-stdin && cargo run -q -- serve',
      cwd: '../server',
      env: {
        ANNETTE_DATABASE_URL: 'sqlite://data/e2e.db',
        ANNETTE_BIND: `127.0.0.1:${apiPort}`,
        ANNETTE_PUBLIC_URL: syncURL,
        RUST_LOG: 'warn',
      },
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: 'pnpm dev --port 5174 --strictPort',
      env: { VITE_HTTPS: '1', API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      url: syncURL,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm vite build && pnpm preview --port 4173 --strictPort',
      url: previewURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
