import { defineConfig, devices } from '@playwright/test'

// SMS → email → dog → password → email login journey, against the Firebase
// emulators + the real api/*.js handlers (scripts/e2e-journey-server.mjs).
// Run inside: firebase emulators:exec --project demo-idogs-journey --only auth,firestore
export default defineConfig({
  testDir: './e2e/journey',
  timeout: 180_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-journey' }]],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE, args: ['--no-sandbox'] } : {} },
  webServer: { command: 'node scripts/e2e-journey-server.mjs', url: 'http://127.0.0.1:4174/__journey/api-log', reuseExistingServer: false, timeout: 60_000, env: { FIREBASE_PROJECT_ID: 'demo-idogs-journey', JOURNEY_PORT: '4174' } },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
})
