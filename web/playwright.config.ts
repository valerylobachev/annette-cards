import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://localhost:5173'
/** The production build with its service worker (the dev server has none); offline.spec.ts serves it again. */
const previewURL = 'http://localhost:4173'

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
      command: 'pnpm vite build && pnpm preview --port 4173 --strictPort',
      url: previewURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
