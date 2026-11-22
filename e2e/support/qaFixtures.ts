import { expect, type Browser, type Page } from '@playwright/test'
import { createPreviewContext, enterSecretly } from './previewContext'

// Shared LP-11 QA account helpers (staging only). See docs/growth-v1/QA_SYNTH_FIXTURES.md.
//
// Fixture provisioning (Release Control #7078332561) uses ONLY the normal app UI as the QA user
// itself: no Firebase Admin, service account, rules change, or collection scan. Before any
// write it requires: staging Preview origin, bundle projectId idogs-app-staging, an authorised
// "+qa" plus-address identity, and an account whose existing dogs are all QA-SYNTH. It is
// idempotent (creates the fixture dog only if missing) and never deletes or edits a dog.

export const STAGING_PROJECT = 'idogs-app-staging'
// Writes are opt-in: the Preview workflow runs automatically on every staging deployment, so
// fixture creation only happens once a reviewer enables the repo Actions variable
// E2E_PROVISION_QA_FIXTURES=1 (Release Control: Codex reviews the setup path before it runs).
export const PROVISION_ALLOWED = process.env.E2E_PROVISION_QA_FIXTURES === '1'
export const MISSING_REASON = 'QA-SYNTH fixture dog missing and provisioning not enabled (set repo Actions variable E2E_PROVISION_QA_FIXTURES=1 after review)'
const QA_IDENTITY = /\+qa[a-z0-9-]*@/i

export type QaAccount = {
  name: 'A' | 'B'
  email?: string
  password?: string
  dog: string
  fixture: { dogName: string; microchip: string; notes: string; pedigree: 'no_pedigree' | 'mixed' }
}

export const QA_A: QaAccount = {
  name: 'A', email: process.env.E2E_STAGING_EMAIL, password: process.env.E2E_STAGING_PASSWORD, dog: 'QA-SYNTH A',
  fixture: { dogName: 'QA-SYNTH A Dog', microchip: '900000000000001', notes: 'QA-SYNTH-PRIVATE-NOTE-A', pedigree: 'mixed' },
}
export const QA_B: QaAccount = {
  name: 'B', email: process.env.E2E_STAGING_EMAIL_2, password: process.env.E2E_STAGING_PASSWORD_2, dog: 'QA-SYNTH B',
  fixture: { dogName: 'QA-SYNTH B Dog', microchip: '900000000000002', notes: 'QA-SYNTH-PRIVATE-NOTE-B', pedigree: 'no_pedigree' },
}

export const configured = (a: QaAccount) => !!a.email && !!a.password

export async function firebaseProjectOf(page: Page): Promise<string | null> {
  for (const src of await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src))) {
    if (!src.startsWith(new URL(page.url()).origin)) continue
    const m = /projectId:"([a-z0-9-]+)"/.exec(await (await page.request.get(src)).text())
    if (m) return m[1]
  }
  return null
}

/** Signs in as a QA account in a fresh origin-bound context, after the staging guards pass. */
export async function signInQa(browser: Browser, base: string, who: QaAccount): Promise<Page> {
  expect(QA_IDENTITY.test(who.email || ''), `account ${who.name} must be an authorised +qa synthetic identity`).toBe(true)
  const context = await createPreviewContext(browser, base, process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
  const page = await context.newPage()
  await page.goto('/login')
  expect(new URL(page.url()).origin, 'navigation stayed on the Preview').toBe(new URL(base).origin)
  expect(await firebaseProjectOf(page), 'refuse to sign in unless the bundle targets staging').toBe(STAGING_PROJECT)
  await enterSecretly(page, 'input[type="email"]', who.email!)
  await enterSecretly(page, 'input[type="password"]', who.password!)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page, `account ${who.name} signs in`).toHaveURL(/\/app\//, { timeout: 25_000 })
  expect(page.url().includes('/verify-email'), `account ${who.name} email is verified`).toBe(false)
  return page
}

/** Dog-card texts on /app/dogs once the list has really loaded (not the "+ Add Dog" link). */
export async function loadDogCards(page: Page): Promise<string[]> {
  await page.goto('/app/dogs')
  const cards = page.locator('a[href^="/app/dogs/"]:not([href="/app/dogs/new"])')
  const empty = page.getByText('No dogs yet', { exact: true })
  const failed = page.getByText("Couldn't load your dogs", { exact: true })
  await expect(cards.first().or(empty).or(failed)).toBeVisible({ timeout: 25_000 })
  expect(await failed.count(), 'dog list loaded (not a loading error)').toBe(0)
  if (await empty.count()) return []
  await page.waitForTimeout(500) // let the rest of the grid render
  return cards.allInnerTexts()
}

/** Idempotently ensure the account's single QA-SYNTH fixture dog exists, via the Add Dog UI. */
export async function ensureFixtureDog(page: Page, who: QaAccount): Promise<'present' | 'created' | 'missing'> {
  const cards = await loadDogCards(page)
  expect(cards.every(t => t.includes('QA-SYNTH')), `account ${who.name} holds only QA-SYNTH dogs (refusing to write otherwise)`).toBe(true)
  if (cards.some(t => t.includes(who.fixture.dogName))) return 'present'
  if (!PROVISION_ALLOWED) return 'missing'
  await createFixtureDogViaForm(page, who)
  return 'created'
}

/** The Add Dog form steps, exactly as a user would (exercised locally by dog-new-fixture-form.spec.ts). */
export async function createFixtureDogViaForm(page: Page, who: QaAccount) {
  await page.goto('/app/dogs/new')
  await page.getByRole('button', { name: /Skip scan, fill manually|Fill in details/ }).first().click()
  const form = page.locator('form')
  await form.getByPlaceholder('Luna').fill(who.fixture.dogName)
  const breed = form.locator('select').filter({ has: page.locator('option', { hasText: 'Select breed…' }) })
  const breeds = await breed.locator('option').evaluateAll(os => (os as HTMLOptionElement[]).map(o => o.value).filter(Boolean))
  await breed.selectOption(breeds.includes('Labrador Retriever') ? 'Labrador Retriever' : breeds[0])
  await form.locator('input[type="date"]').first().fill('2024-01-15')
  await form.getByPlaceholder('956000012345678').fill(who.fixture.microchip)
  const pedigree = form.locator('select').filter({ has: page.locator('option[value="no_pedigree"]') })
  if (await pedigree.count()) await pedigree.selectOption(who.fixture.pedigree)
  await form.getByPlaceholder('Any notes about this dog…').fill(who.fixture.notes)
  await form.locator('button[type="submit"]').click()
  expect(await page.getByRole('button', { name: 'Add anyway' }).isVisible().catch(() => false), 'no duplicate-dog warning for the fixture').toBe(false)
  await expect(page, `account ${who.name} fixture dog created`).toHaveURL(/\/app\/dogs\/(?!new$)[^/]+$/, { timeout: 30_000 })
  await expect(page.getByText(who.fixture.dogName).first()).toBeVisible({ timeout: 20_000 })
}

/** Sign in, ensure the fixture, close. Safe to call from every project's beforeAll. */
export async function provisionQaFixture(browser: Browser, base: string, who: QaAccount) {
  const page = await signInQa(browser, base, who)
  try {
    return await ensureFixtureDog(page, who)
  } finally {
    await page.context().close()
  }
}
