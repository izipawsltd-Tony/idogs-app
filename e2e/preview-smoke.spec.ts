import { expect, test, type Page } from '@playwright/test'

// Staging Preview smoke. Read-only except the optional signed-in block, which
// only runs when (a) the bundle is proven to target Firebase idogs-app-staging
// and (b) dedicated staging QA test-account secrets are configured.

const STAGING_PROJECT = 'idogs-app-staging'

async function firebaseProjectOf(page: Page): Promise<string | null> {
  const srcs = await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src))
  for (const src of srcs) {
    if (!src.startsWith(new URL(page.url()).origin)) continue
    const text = await (await page.request.get(src)).text()
    const m = /projectId:"([a-z0-9-]+)"/.exec(text) || /"projectId":"([a-z0-9-]+)"/.exec(text)
    if (m) return m[1]
  }
  return null
}

test.describe('Preview smoke', () => {
  test('Preview is reachable (bypass works) and targets STAGING Firebase only', async ({ page }) => {
    const res = await page.goto('/login')
    expect(res?.status(), 'Preview should not be behind Vercel login').toBeLessThan(400)
    expect(new URL(page.url()).hostname).not.toBe('vercel.com')
    expect(await firebaseProjectOf(page)).toBe(STAGING_PROJECT)
  })

  test('login page renders email/password form without page errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/login')
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('no horizontal overflow on login (mobile safety)', async ({ page }) => {
    await page.goto('/login')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  for (const path of ['/', '/privacy', '/terms', '/forgot-password']) {
    test(`public route ${path} loads`, async ({ page }) => {
      const res = await page.goto(path)
      expect(res?.status()).toBeLessThan(400)
      await expect(page.locator('body')).not.toBeEmpty()
    })
  }

  test('protected app route redirects signed-out users to login', async ({ page }) => {
    await page.goto('/app/documents')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Signed-in staging QA account (read-only)', () => {
  const email = process.env.E2E_STAGING_EMAIL
  const password = process.env.E2E_STAGING_PASSWORD
  test.skip(!email || !password, 'Staging QA account secrets not configured')

  test('documents and settings render for the QA account', async ({ page }) => {
    await page.goto('/login')
    expect(await firebaseProjectOf(page), 'refuse to sign in unless the bundle targets staging').toBe(STAGING_PROJECT)
    await page.locator('input[type="email"]').first().fill(email!)
    await page.locator('input[type="password"]').first().fill(password!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 })
    await page.goto('/app/documents')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
    await expect(page.getByText(/document(s)? saved|Document count unavailable/)).toBeVisible()
    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })
})
