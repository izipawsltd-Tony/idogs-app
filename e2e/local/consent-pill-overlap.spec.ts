import { expect, test, type Page } from '@playwright/test'

// Growth V1 RC (21 Nov 2026): on phones the floating "Ad privacy choices" pill covered the
// hero "Explore iDogs for Breeders" link. The pill must never overlap ANY link or button
// (not only signup CTAs), at first view or anywhere while scrolling. On phones it is
// docked in the landing footer (never inside the sticky bar: Codex 22 Nov found a docked
// bar row intercepted taps on the Breeders link); elsewhere on small screens it sits
// in-flow at the page end; on desktop it floats as before.
async function overlaps(page: Page) {
  return page.evaluate(() => {
    const pill = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Ad privacy choices')
    if (!pill) return ['pill missing']
    const p = pill.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('a[href], button')].filter(e => e !== pill && !e.contains(pill) && !pill.contains(e)).flatMap(e => {
      const r = e.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) return []
      const x = Math.min(r.right, p.right) - Math.max(r.left, p.left)
      const y = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top)
      if (!(x > 0.5 && y > 0.5)) return []
      // Only a real interception counts: the pill must be what a tap there would hit. (The
      // footer pill can pass BEHIND the sticky bar while scrolling; the bar is on top then.)
      const cx = (Math.max(r.left, p.left) + Math.min(r.right, p.right)) / 2
      const cy = (Math.max(r.top, p.top) + Math.min(r.bottom, p.bottom)) / 2
      const top = document.elementFromPoint(cx, cy)
      return top && pill.contains(top) ? [`${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40)} @scrollY=${Math.round(scrollY)}`] : []
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
    await pill.scrollIntoViewIfNeeded()
    await expect(pill).toBeVisible()
    expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(44)
    await pill.click()
    await expect(page.getByRole('dialog', { name: 'Ad privacy choices' })).toBeVisible()
  })
}

test('phones: the pill is in the footer, never in the sticky bar, and tappable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' })
  const bar = page.locator('.sticky-cta')
  test.skip(!(await bar.isVisible()), 'sticky bar is phone-only (<=620px)')
  await expect(bar.getByRole('button', { name: 'Ad privacy choices' })).toHaveCount(0)
  const pill = page.locator('footer').getByRole('button', { name: 'Ad privacy choices' })
  await pill.scrollIntoViewIfNeeded()
  await expect(pill).toBeVisible()
  const p = (await pill.boundingBox())!
  const b = (await bar.boundingBox())!
  expect(p.y + p.height, 'footer pill scrolls clear of the sticky bar').toBeLessThanOrEqual(b.y + 0.5)
  expect(p.height, 'tap target').toBeGreaterThanOrEqual(44)
  for (const link of await bar.locator('.sticky-cta-row a').all()) expect((await link.boundingBox())!.height, 'CTA still one line').toBeLessThanOrEqual(52)
})

// Codex 22 Nov reproduction: touch, 10 px scroll steps, hit-test the hero Breeders link at
// 12% / 50% / 88% of its width. Whatever the link is under, it must never be the pill.
test('scrolling: the hero Breeders link is never intercepted by the consent pill', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: { promotionSuperseded: true, launch: { active: true, remaining: 60, endsAt: '2026-12-31T13:30:00Z', showRemaining: true }, pass: { active: false, endsAt: '' } } }))
  await page.goto('/', { waitUntil: 'load' })
  await page.waitForTimeout(400)
  const hits: string[] = []
  for (let y = 0; y <= 900; y += 10) {
    await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y)
    hits.push(...await page.evaluate(() => {
      const a = document.querySelector<HTMLElement>('.breeder-link a')
      if (!a) return ['breeder link missing']
      const r = a.getBoundingClientRect()
      if (r.bottom <= 0 || r.top >= innerHeight) return []
      return [0.12, 0.5, 0.88].flatMap(f => {
        const e = document.elementFromPoint(r.left + r.width * f, Math.min(r.top + r.height / 2, innerHeight - 1))
        return e?.closest('.idogs-ad-privacy-pill') ? [`pill @scrollY=${Math.round(scrollY)} x=${f}`] : []
      })
    }))
  }
  expect(hits).toEqual([])
})
