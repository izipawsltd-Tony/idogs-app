import { expect, test, type Page } from '@playwright/test'

// Growth V1 RC (21 Nov 2026): on phones the floating "Ad privacy choices" pill covered the
// hero "Explore iDogs for Breeders" link. The pill must never overlap ANY link or button
// (not only signup CTAs), at first view or anywhere while scrolling. On phones it is
// docked inside the sticky CTA bar; on other small screens it sits in-flow at the page end;
// on desktop it floats as before.
async function overlaps(page: Page) {
  return page.evaluate(() => {
    const pill = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Ad privacy choices')
    if (!pill) return ['pill missing']
    const p = pill.getBoundingClientRect()
    // Docked in the sticky bar: page content scrolling BEHIND the bar is covered by the bar
    // itself (accepted pre-existing layout, see consent-cta.spec), so compare with the bar's
    // own controls. Floating or in-flow: compare with every link/button on the page.
    const bar = pill.closest('.sticky-cta')
    const scope = bar ? [...bar.querySelectorAll<HTMLElement>('a[href], button')] : [...document.querySelectorAll<HTMLElement>('a[href], button')]
    return scope.filter(e => e !== pill && !e.contains(pill) && !pill.contains(e)).flatMap(e => {
      const r = e.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) return []
      const x = Math.min(r.right, p.right) - Math.max(r.left, p.left)
      const y = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top)
      return x > 0.5 && y > 0.5 ? [`${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40)} @scrollY=${Math.round(scrollY)}`] : []
    })
  })
}

for (const path of ['/', '/signup']) {
  test(`${path}: consent pill never overlaps a link or button while scrolling`, async ({ page }) => {
    await page.route('**/api/offer-status', r => r.fulfill({ json: { promotionSuperseded: true, launch: { active: true, remaining: 60, endsAt: '2026-12-31T13:30:00Z', showRemaining: true }, pass: { active: false, endsAt: '' } } }))
    await page.goto(path, { waitUntil: 'load' })
    const pill = page.getByRole('button', { name: 'Ad privacy choices' })
    await expect(pill).toBeVisible()
    await page.waitForTimeout(400)
    const bad: string[] = []
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    const vh = page.viewportSize()!.height
    for (let y = 0; y <= height; y += Math.round(vh / 3)) {
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y)
      await page.waitForTimeout(60)
      bad.push(...await overlaps(page))
    }
    expect(bad, 'links/buttons covered by the consent pill').toEqual([])
    // Still reachable, compact and opens the dialog from wherever it lives.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
    await expect(pill).toBeVisible()
    expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(44)
    await pill.click()
    await expect(page.getByRole('dialog', { name: 'Ad privacy choices' })).toBeVisible()
  })
}

test('phones: the pill sits inside the sticky CTA bar above both buttons', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' })
  const bar = page.locator('.sticky-cta')
  test.skip(!(await bar.isVisible()), 'sticky bar is phone-only (<=620px)')
  const pill = bar.getByRole('button', { name: 'Ad privacy choices' })
  await expect(pill).toBeVisible()
  const p = (await pill.boundingBox())!
  for (const link of await bar.locator('.sticky-cta-row a').all()) {
    const b = (await link.boundingBox())!
    expect(p.y + p.height, 'pill above the CTA row').toBeLessThanOrEqual(b.y + 0.5)
    expect(b.height, 'CTA still one line').toBeLessThanOrEqual(52)
  }
  expect(p.height, 'tap target').toBeGreaterThanOrEqual(24)
})
