import { expect, test, type Page } from '@playwright/test'

// Authenticated functional QA on a Vercel STAGING Preview with a dedicated
// staging QA account (never a customer). Self-contained: uploads its own
// uniquely-named document, exercises View → Edit (persist) → Delete, and
// removes what it created. Refuses to run unless the bundle targets the
// staging Firebase project.

const STAGING_PROJECT = 'idogs-app-staging'
const email = process.env.E2E_STAGING_EMAIL
const password = process.env.E2E_STAGING_PASSWORD
// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function firebaseProjectOf(page: Page): Promise<string | null> {
  const srcs = await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src))
  for (const src of srcs) {
    if (!src.startsWith(new URL(page.url()).origin)) continue
    const m = /projectId:"([a-z0-9-]+)"/.exec(await (await page.request.get(src)).text())
    if (m) return m[1]
  }
  return null
}

async function signIn(page: Page) {
  await page.goto('/login')
  expect(await firebaseProjectOf(page), 'refuse to sign in unless the bundle targets staging').toBe(STAGING_PROJECT)
  await page.locator('input[type="email"]').first().fill(email!)
  await page.locator('input[type="password"]').first().fill(password!)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/\/app\//, { timeout: 25_000 })
}

const row = (page: Page, text: string) =>
  page.locator('div').filter({ hasText: text }).filter({ has: page.getByRole('button', { name: /Delete/ }) }).last()

test.describe('Documents View → Edit → Delete on staging (QA account)', () => {
  test.skip(!email || !password, 'Staging QA account secrets not configured')
  test.describe.configure({ mode: 'serial' })

  test('full Documents lifecycle, Dog Detail actions, promotion and layout', async ({ page }, info) => {
    const stamp = `E2E ${info.project.name} ${Date.now()}`
    const renamed = `${stamp} renamed`
    await signIn(page)

    // Upload a document of our own (no reliance on existing data).
    await page.goto('/app/documents')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
    await page.getByRole('button', { name: '+ Upload Document' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Upload Document' })
    const dogSelect = dialog.getByLabel('Dog')
    const dogOptions = await dogSelect.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value).filter(Boolean))
    expect(dogOptions.length, 'staging QA account needs at least one dog').toBeGreaterThan(0)
    const dogId = dogOptions[0]
    await dogSelect.selectOption(dogId)
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: PNG })
    await dialog.getByPlaceholder(/^e\.g\. /).first().fill(stamp)
    await dialog.getByRole('button', { name: 'Upload Document' }).click()
    await expect(page.getByText(stamp, { exact: true })).toBeVisible({ timeout: 30_000 })

    // Action order on the Documents page: View → Edit → Delete.
    const labels = await row(page, stamp).getByRole('button').allInnerTexts()
    const order = ['View', 'Edit', 'Delete'].map(l => labels.findIndex(t => t.includes(l)))
    expect(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2], `buttons: ${labels.join(' | ')}`).toBe(true)

    // View requests a short-lived signed URL for this private file.
    const signed = page.waitForResponse(r => r.url().includes('/api/get-signed-url'))
    const popup = page.context().waitForEvent('page').catch(() => null)
    await row(page, stamp).getByRole('button', { name: /View/ }).click()
    expect((await signed).status()).toBe(200)
    await (await popup)?.close()

    // Edit → rename persists across reload.
    await row(page, stamp).getByRole('button', { name: 'Edit' }).click()
    await page.locator('#document-edit-name').fill(renamed)
    await page.getByRole('dialog', { name: 'Edit document' }).getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 20_000 })

    // No horizontal overflow on the Documents page (mobile project especially).
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

    // Dog Detail → Documents tab shows the same document with View → Edit → Delete.
    await page.goto(`/app/dogs/${dogId}`)
    await page.getByRole('button', { name: /Documents \(/ }).first().click()
    const dlabels = await row(page, renamed).getByRole('button').allInnerTexts()
    const dorder = ['View', 'Edit', 'Delete'].map(l => dlabels.findIndex(t => t.includes(l)))
    expect(dorder.every(i => i >= 0) && dorder[0] < dorder[1] && dorder[1] < dorder[2], `dog detail buttons: ${dlabels.join(' | ')}`).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

    // Delete: cancel keeps it, confirm removes it (and it stays gone after reload).
    await page.goto('/app/documents')
    page.once('dialog', d => d.dismiss())
    await row(page, renamed).getByRole('button', { name: /Delete/ }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()
    page.once('dialog', d => d.accept())
    await row(page, renamed).getByRole('button', { name: /Delete/ }).click()
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)

    // Plus promotion: A$7 struck through next to A$0/month on Billing (web).
    await page.goto('/app/billing')
    const promo = page.locator('.plus-promotion')
    if (await promo.count()) {
      await expect(promo.locator('del')).toContainText('7')
      await expect(promo).toContainText('A$0')
    } else {
      test.info().annotations.push({ type: 'note', description: 'Promotion not rendered for this account/interval' })
    }
  })
})
