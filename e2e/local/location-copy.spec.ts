import { expect, test } from '@playwright/test'

// Rendered check of the Australia location copy (Owner directive 21 Nov 2026) and of
// the legal text that must NOT change. Wait for the legal section headings first.
test('home footer names Australia, voucher keeps Adelaide time', async ({ page }) => {
  await page.route('**/api/offer-status', r => r.fulfill({ json: { promotionSuperseded: true, launch: { active: true, remaining: 60, endsAt: '2026-12-31T13:30:00Z', showRemaining: true }, pass: { active: false, endsAt: '' } } }))
  await page.goto('/', { waitUntil: 'load' })
  const footer = page.locator('.foot-copy', { hasText: 'iDogs is operated by' })
  await expect(footer).toContainText('iziPaws Pty Ltd (ABN 42 693 563 745), Australia.')
  await expect(footer).not.toContainText('Adelaide')
  await expect(page.locator('body')).toContainText('Adelaide time')
})

test('privacy sections 1 and 11 name Australia and keep the complaint route', async ({ page }) => {
  await page.goto('/privacy', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: /1\. Who We Are/ })).toBeVisible()
  await expect(page.locator('body')).toContainText('We operate in Australia.')
  await expect(page.getByRole('heading', { name: /11\. Contact and Complaints/ })).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).toContain('hello@idogs.com.au')
  expect(text).toContain('OAIC')
  expect(text).not.toMatch(/Adelaide/)
})

test('terms section 12 names Australia; governing law (section 11) still names South Australia', async ({ page }) => {
  await page.goto('/terms', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: /12\. Contact/ })).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).toMatch(/ABN: 42 693 563 745\s+Australia\s+Email: hello@idogs\.com\.au/)
  expect(text).toContain('governed by the laws of South Australia')
  expect(text).not.toMatch(/Adelaide/)
})
