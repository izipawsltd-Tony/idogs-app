import { expect, test } from '@playwright/test'

// P0 Zero New Signups (Owner directive 6564223316) — synthetic, privacy-safe
// funnel checks against a LOCAL production build. No real Firebase project,
// no SMS, no email, no payment: every Google/Firebase/Meta request is aborted,
// so these cover the ad landing → CTA → signup form → validation → failure
// handling path. Real account creation is covered by the Auth emulator E2E and
// (once secrets exist) by the staging Preview E2E.
const AD_URL = '/?fbclid=SYNTHETIC&utm_source=facebook&utm_medium=paid&utm_campaign=qa&utm_id=120&ad_id=3&placement=Instagram_Stories'

test.beforeEach(async ({ page }) => {
  await page.route(/googleapis\.com|firebaseio\.com|gstatic\.com\/recaptcha|google\.com\/recaptcha|connect\.facebook\.net|facebook\.com/, route => route.abort())
})

test('ad landing URL with Meta/UTM parameters loads and Start Free reaches the signup form', async ({ page }) => {
  await page.goto(AD_URL, { waitUntil: 'load' })
  await expect(page.locator('h1').first()).toBeVisible()
  const cta = page.locator('a[href^="/signup"]').filter({ visible: true }).first()
  await expect(cta).toBeVisible()
  await cta.click()
  await expect(page).toHaveURL(/\/signup/)
  // No form data or identifiers are ever placed in the URL.
  expect(page.url()).not.toMatch(/email|phone|password/i)
  await expect(page.getByLabel('User name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create free account' })).toBeVisible()
})

test('signup without accepting Terms is refused with a clear message (no account request sent)', async ({ page }) => {
  const authCalls: string[] = []
  page.on('request', r => { if (/identitytoolkit|securetoken/.test(r.url())) authCalls.push(r.url()) })
  await page.goto('/signup', { waitUntil: 'load' })
  await page.getByLabel('User name').fill('Synthetic QA')
  await page.getByLabel('Email address').fill('synthetic-qa@example.invalid')
  await page.locator('input[autocomplete="new-password"]').fill('Synthetic-Password-2026!')
  await page.getByRole('button', { name: 'Create free account' }).click()
  await expect(page.getByRole('alert')).toContainText('agree to the Terms')
  expect(authCalls.filter(u => /signUp|accounts:/.test(u))).toHaveLength(0)
})

test('a backend failure during signup shows an actionable error and the form stays usable', async ({ page }) => {
  await page.goto('/signup', { waitUntil: 'load' })
  await page.getByLabel('User name').fill('Synthetic QA')
  await page.getByLabel('Email address').fill('synthetic-qa@example.invalid')
  await page.locator('input[autocomplete="new-password"]').fill('Synthetic-Password-2026!')
  await page.locator('.idogs-auth-consent input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Create free account' }).click()
  await expect(page.getByRole('alert')).toContainText(/Could not create your account|try again/i, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Create free account' })).toBeEnabled()
  expect(page.url()).toMatch(/\/signup/)
})

test('Mobile number tab renders the SMS form and its fallback when mobile sign-in is unavailable', async ({ page }) => {
  await page.goto('/signup', { waitUntil: 'load' })
  await page.locator('.idogs-auth-tabs').getByRole('button', { name: 'Mobile number' }).click()
  await expect(page.getByLabel('User name')).toBeVisible()
  await expect(page.getByText(/Mobile sign-in could not be loaded|Checking mobile sign-in availability|send a sign-in code by SMS/)).toBeVisible()
  // The signup form never loads the Meta SDK without an explicit Allow.
  expect(await page.locator('script[src*="fbevents"]').count()).toBe(0)
})

test('no horizontal overflow on the signup form', async ({ page }) => {
  await page.goto('/signup', { waitUntil: 'load' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
