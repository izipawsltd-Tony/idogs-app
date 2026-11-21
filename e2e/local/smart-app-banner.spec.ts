import { expect, test } from '@playwright/test'

// LP-06B: the built, served pages carry Apple's native Smart App Banner meta and
// nothing app-promotional is injected into the page itself (no custom popup/sheet).
// Whether Safari actually shows the banner depends on iOS state and must be checked
// on a real iPhone (Owner QA), not here.
for (const path of ['/', '/signup', '/login', '/privacy']) {
  test(`${path} serves the native banner meta and no custom app prompt`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    const meta = page.locator('meta[name="apple-itunes-app"]')
    await expect(meta).toHaveCount(1)
    await expect(meta).toHaveAttribute('content', 'app-id=6823094602')
    await expect(page.locator('[role="dialog"]', { hasText: /app store|download.*app|get the app/i })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  })
}
