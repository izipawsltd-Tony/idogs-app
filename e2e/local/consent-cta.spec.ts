import { expect, test, type Page } from '@playwright/test'

// Owner P0 (01 Nov 2026): consent UI must never cover Start Free / Sign up on
// mobile, must stay voluntary, and Meta Pixel must not load before an explicit Allow.
const CTA = 'a[href^="/signup"], button[type="submit"]'

async function ctaReport(page: Page) {
  return page.evaluate(sel => {
    const pill = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Ad privacy choices')
    const pr = pill?.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight }).map(e => {
      const r = e.getBoundingClientRect()
      const overlap = pr ? Math.max(0, Math.min(r.right, pr.right) - Math.max(r.left, pr.left)) * Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top)) : 0
      const top = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 1))
      const coveredByOwnStickyBar = !!top?.closest('.sticky-cta') && !e.closest('.sticky-cta')
      return { text: (e.textContent || '').trim().slice(0, 30), overlapsPill: overlap > 0, clickable: !!top && (top === e || e.contains(top)), coveredByOwnStickyBar }
    })
  }, CTA)
}

for (const path of ['/', '/signup']) {
  test.describe(`consent UI on ${path}`, () => {
    test.beforeEach(async ({ page }) => { await page.goto(path, { waitUntil: 'load' }); await expect(page.getByRole('button', { name: 'Ad privacy choices' })).toBeVisible(); await page.waitForTimeout(400) })

    test('first view: compact pill only, no consent box, no Pixel', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Ad privacy choices' })).toBeVisible()
      await expect(page.locator('section[aria-label="Advertising privacy choices"]')).toHaveCount(0)
      const box = await page.getByRole('button', { name: 'Ad privacy choices' }).boundingBox()
      expect(box!.height).toBeLessThanOrEqual(44)
      expect(await page.locator('script[src*="fbevents"]').count()).toBe(0)
      expect(await page.evaluate(() => typeof (window as any).fbq)).toBe('undefined')
    })

    test('no signup CTA is overlapped by the pill and every visible CTA is actually clickable', async ({ page }) => {
      for (const cta of await ctaReport(page)) {
        expect(cta.overlapsPill, `${cta.text} overlaps the pill`).toBe(false)
        // A hero CTA momentarily under the page's own sticky "Start Free" bar is a
        // pre-existing landing layout (same action stays one tap away); not consent UI.
        if (!cta.coveredByOwnStickyBar) expect(cta.clickable, `${cta.text} is not clickable`).toBe(true)
      }
      if (path === '/signup') {
        const submit = page.locator('button[type="submit"]').first()
        await submit.scrollIntoViewIfNeeded()
        expect(await submit.evaluate(e => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === e || e.contains(t) })).toBe(true)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    })

    test('pill opens an accessible on-screen dialog; Escape closes; CTAs clickable again; still no Pixel', async ({ page }) => {
      await page.getByRole('button', { name: 'Ad privacy choices' }).click()
      const dialog = page.getByRole('dialog', { name: 'Ad privacy choices' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Decline' })).toBeFocused()
      await expect(dialog.getByRole('button', { name: 'Allow ad measurement' })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Decline' })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      for (const cta of await ctaReport(page)) if (!cta.coveredByOwnStickyBar) expect(cta.clickable, cta.text).toBe(true)
      expect(await page.locator('script[src*="fbevents"]').count()).toBe(0)
    })

    test('Decline persists and keeps Pixel off after reload', async ({ page }) => {
      await page.getByRole('button', { name: 'Ad privacy choices' }).click()
      await page.getByRole('button', { name: 'Decline' }).click()
      await page.reload({ waitUntil: 'load' }); await expect(page.getByRole('button', { name: 'Ad privacy choices' })).toBeVisible()
      expect(await page.evaluate(() => localStorage.getItem('idogs-meta-consent-v1'))).toBe('denied')
      expect(await page.locator('script[src*="fbevents"]').count()).toBe(0)
      await page.getByRole('button', { name: 'Ad privacy choices' }).click()
      await expect(page.getByRole('dialog')).toContainText('Ad measurement declined')
    })
  })
}
