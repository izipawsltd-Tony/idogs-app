import { defineConfig, devices } from '@playwright/test'

// Preview E2E against a Vercel STAGING Preview. BASE_URL is validated by the
// workflow (idogs-app-staging-*.vercel.app only). The Vercel protection bypass
// secret is sent only as a header to that host and is never logged.
const baseURL = process.env.BASE_URL
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['local/**', 'journey/**'], // local + emulator journey checks have their own configs
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
