import { defineConfig, devices } from '@playwright/test'

// Real-browser layout checks against a LOCAL production-style build (no
// network, no Firebase calls needed for the public marketing pages). Used by CI.
export default defineConfig({
  testDir: './e2e/local',
  timeout: 30_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-local' }]],
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure', launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE, args: ['--no-sandbox'] } : {} },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: 'iphone-se-320', use: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 }, browserName: 'chromium' } },
    { name: 'iphone-375', use: { ...devices['iPhone 13 mini'], viewport: { width: 375, height: 812 }, browserName: 'chromium' } },
    { name: 'iphone-390', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'iphone-430', use: { ...devices['iPhone 14 Pro Max'], browserName: 'chromium' } },
    { name: 'iphone-landscape', use: { ...devices['iPhone 13 landscape'], browserName: 'chromium' } },
    { name: 'android-pixel7', use: { ...devices['Pixel 7'] } },
  ],
})
