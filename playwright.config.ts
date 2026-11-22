import { defineConfig, devices } from '@playwright/test'
import { PREVIEW_STATE } from './e2e/support/state-path'

// Preview E2E against a Vercel STAGING Preview. BASE_URL is validated by the
// workflow and by global setup (idogs-app-staging-*.vercel.app only). The Vercel
// protection bypass secret is sent once, origin-bound, by global setup to obtain a
// host-only cookie; it is never a context-wide header (Codex #7077157877), never
// logged, and traces are off so no request headers or typed values reach the report.
const baseURL = process.env.BASE_URL

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['local/**', 'journey/**'], // local + emulator journey checks have their own configs
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL,
    storageState: PREVIEW_STATE,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
