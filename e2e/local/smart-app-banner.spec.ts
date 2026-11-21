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

// LP-06B clarity fallback: in-app browsers (Facebook/Instagram) and Chrome on iOS
// never show Safari's banner, so the page's own iPhone CTA must be self-explanatory.
// The always-visible mobile sticky bar shows a labelled "Get app" button (it was an
// unlabelled phone icon), and both sticky buttons stay on one line inside the screen.
test('mobile sticky bar has a visible, readable "Get app" label', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: { promotionSuperseded: true, launch: { active: false }, pass: { active: false, endsAt: '' } } }))
  await page.goto('/', { waitUntil: 'load' })
  const bar = page.locator('.sticky-cta')
  test.skip(!(await bar.isVisible()), 'sticky bar is mobile-only (<=620px)')
  const app = bar.getByRole('link', { name: /iPhone app on the App Store/ })
  await expect(app).toHaveText('Get app')
  await expect(app).toHaveAttribute('href', 'https://apps.apple.com/au/app/idogs/id6823094602')
  const vw = page.viewportSize()!.width
  for (const link of await bar.getByRole('link').all()) {
    const b = (await link.boundingBox())!
    expect(b.x, 'inside screen (left)').toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, 'inside screen (right)').toBeLessThanOrEqual(vw + 0.5)
    expect(b.height, 'label on one line, >=44px tap target').toBeGreaterThanOrEqual(44)
    expect(b.height).toBeLessThanOrEqual(52)
  }
})
