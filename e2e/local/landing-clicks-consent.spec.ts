import { expect, test, type Page } from '@playwright/test'

// Growth V1 (Owner decision 20 Nov 2026, Option C): homepage click counters run
// ONLY after the visitor chooses "Allow ad measurement".
// Chromium hides sendBeacon Blob bodies from request.postData(), so the page's
// sendBeacon is wrapped to record each payload (it still sends the real request).
async function watchBeacons(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __beacons: string[] }
    w.__beacons = []
    const orig = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (String(url).includes('/api/landing-beacon') && data instanceof Blob) void data.text().then(t => { try { w.__beacons.push(JSON.parse(t).event) } catch { /* ignore */ } })
      return orig(url, data)
    }
  })
  const requests: string[] = []
  page.on('request', r => { if (r.url().includes('/api/landing-beacon')) requests.push(r.url()) })
  return { requests, events: () => page.evaluate(() => (window as unknown as { __beacons: string[] }).__beacons) }
}
const openStore = async (page: Page) => {
  await page.evaluate(() => { for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="apps.apple.com"]')) { a.addEventListener('click', e => e.preventDefault()) } })
  await page.locator('a[href*="apps.apple.com"]').first().click()
  await page.waitForTimeout(500)
}

test('no click is counted before the visitor chooses', async ({ page }) => {
  const beacon = await watchBeacons(page)
  await page.goto('/', { waitUntil: 'load' })
  await expect(page.getByRole('button', { name: 'Ad privacy choices' })).toBeVisible()
  await openStore(page)
  expect(beacon.requests).toEqual([])
  expect(await beacon.events()).toEqual([])
})

test('no click is counted after Decline', async ({ page }) => {
  const beacon = await watchBeacons(page)
  await page.goto('/', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Ad privacy choices' }).click()
  await page.locator('button[data-choice="denied"]').click()
  await openStore(page)
  expect(beacon.requests).toEqual([])
  expect(await beacon.events()).toEqual([])
})

test('the App Store click is counted once after Allow', async ({ page }) => {
  const beacon = await watchBeacons(page)
  await page.goto('/', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Ad privacy choices' }).click()
  await page.locator('button[data-choice="granted"]').click()
  await openStore(page)
  expect(await beacon.events()).toEqual(['app_store'])
  expect(beacon.requests).toHaveLength(1)
})
