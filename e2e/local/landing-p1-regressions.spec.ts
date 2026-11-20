import { expect, test, type Page } from '@playwright/test'

// Regression tests for the three P1 defects found by independent QA (Issue #103,
// SHA 3586569): pricing overflow, breeder hero jump, and the superseded A$0
// promotion flashing before the offer status resolves.
const VOUCHER = { promotionSuperseded: true, launch: { active: true, remaining: 60, endsAt: '2026-12-31T13:30:00Z', showRemaining: true }, pass: { active: false, endsAt: '' } }
const PROMO_ONLY = { promotionSuperseded: false, launch: { active: false, remaining: 0, endsAt: '2026-12-31T13:30:00Z', showRemaining: false }, pass: { active: false, endsAt: '' } }
const PROMO_TEXT = /A\$0\/month through 31 January 2027/

async function noHorizontalOverflow(page: Page) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(m.sw, `scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw)
}

test('P1-01 pricing fits the viewport with the voucher live', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: VOUCHER }))
  await page.goto('/', { waitUntil: 'load' })
  await expect(page.getByTestId('pricing-voucher-price')).toBeAttached()
  await noHorizontalOverflow(page)
})

test('P1-01 pricing fits the viewport with only the A$0 promotion live', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: PROMO_ONLY }))
  await page.goto('/', { waitUntil: 'load' })
  await page.waitForTimeout(600)
  await noHorizontalOverflow(page)
})

test('P1-02 breeder hero link lands the Breeders section below the sticky header', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: VOUCHER }))
  await page.goto('/', { waitUntil: 'load' })
  await page.getByRole('link', { name: /Explore iDogs for Breeders/i }).first().click()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#for-breeders')
  await expect.poll(async () => page.evaluate(() => {
    const top = document.getElementById('for-breeders')!.getBoundingClientRect().top
    const hdr = document.querySelector('header')!.getBoundingClientRect().bottom
    return top >= hdr - 1 && top < window.innerHeight * 0.6
  })).toBe(true)
})

test('P1-03 no A$0 promotion is advertised while the offer status is loading', async ({ page }) => {
  await page.route('**/api/offer-status', async r => { await new Promise(res => setTimeout(res, 2500)); await r.fulfill({ json: VOUCHER }) })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Immediate snapshots (expect().not.toContainText would retry until the status resolved and hide the flash).
  for (const wait of [200, 600, 800]) {
    await page.waitForTimeout(wait)
    const text = await page.evaluate(() => document.body.innerText)
    expect(text, 'promotion advertised before offer status resolved').not.toMatch(PROMO_TEXT)
    expect(text).not.toContain('Get Plus for A$0')
    expect(await page.getByTestId('hero-launch-offer').count()).toBe(0)
  }
  await expect(page.getByTestId('hero-launch-offer')).toBeVisible({ timeout: 6000 })
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(PROMO_TEXT)
})

test('P1-03 a failed offer-status request stays neutral (no promotion claim)', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.abort())
  await page.goto('/', { waitUntil: 'load' })
  await page.waitForTimeout(700)
  await expect(page.locator('body')).not.toContainText(PROMO_TEXT)
  await expect(page.getByTestId('hero-launch-offer')).toHaveCount(0)
  await noHorizontalOverflow(page)
})
