import { expect, test, type Page } from '@playwright/test'

// Independent QA 4 Nov 2026 (#69 comment 6627093690), P2 findings:
//  1. Free account with 2 active dogs → My Dogs → Add dog hit a dead-end
//     upsell that claimed documents/scan/transfer need Plus.
//  2. 2 overdue + 0 upcoming reminders → Reminders said "All caught up!".
// Real app UI against the Auth + Firestore emulators (no real email/SMS/payment).
const PROJECT = 'demo-idogs-journey'
const AUTH = 'http://127.0.0.1:9099'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const PASSWORD = 'Free-Limit-QA-2026!'

type Value = { stringValue: string } | { booleanValue: boolean } | { integerValue: string }
const str = (v: string): Value => ({ stringValue: v })

async function createVerifiedUser(email: string) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=journey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) })
  expect(r.ok, 'emulator signUp').toBe(true)
  const { localId } = await r.json() as { localId: string }
  const u = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: OWNER, body: JSON.stringify({ localId, emailVerified: true }) })
  expect(u.ok, 'emulator mark verified').toBe(true)
  return localId
}
async function fsCreate(path: string, id: string, fields: Record<string, Value>) {
  const r = await fetch(`${FS}/${path}?documentId=${id}`, { method: 'POST', headers: OWNER, body: JSON.stringify({ fields }) })
  expect(r.ok, `create ${path}/${id}`).toBe(true)
}
async function fsDelete(path: string) {
  expect((await fetch(`${FS}/${path}`, { method: 'DELETE', headers: OWNER })).ok).toBe(true)
}
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

async function dismissStateModal(page: Page) {
  const save = page.getByRole('button', { name: 'Save and continue' })
  if (await save.isVisible().catch(() => false)) {
    await page.locator('select.form-select').first().selectOption('SA')
    await save.click()
    await expect(save).toBeHidden()
  }
}
async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw, 'no horizontal page scroll').toBeLessThanOrEqual(cw + 1)
}

test('Free 2/2 dogs: plan-aware action before Add Dog; overdue reminders shown first', async ({ page }, info) => {
  test.setTimeout(150_000)
  const tag = info.project.name.includes('desktop') ? 'd' : 'm'
  const email = `free-limit-${tag}@example.invalid`
  const uid = await createVerifiedUser(email)
  const now = new Date().toISOString()
  await fsCreate('users', uid, { uid: str(uid), email: str(email), firstName: str('Free'), lastName: str('QA'), kennelName: str(''), role: str('owner'), plan: str('free'), state: str('SA'), createdAt: str(now) })
  const dogIds = [`${uid}-dog-a`, `${uid}-dog-b`]
  for (const [i, id] of dogIds.entries()) {
    await fsCreate('dogs', id, { name: str(i ? 'Limit Bella' : 'Limit Ruby'), breed: str('Labrador Retriever'), sex: str('female'), dateOfBirth: str('2022-03-01'), status: str('active'), tenantId: str(uid), currentOwnerId: str(uid), passportId: str(`QA-2026-${tag.toUpperCase()}${i}`), createdAt: str(now) })
  }
  // QA repro data: two overdue, nothing due later, one completed.
  await fsCreate('reminders', `${uid}-r1`, { dogId: str(dogIds[0]), tenantId: str(uid), type: str('vaccination'), title: str('C5 booster overdue'), dueDate: str(isoDay(-9)), notifyDaysBefore: { integerValue: '7' }, status: str('pending'), createdAt: str(now) })
  await fsCreate('reminders', `${uid}-r2`, { dogId: str(dogIds[1]), tenantId: str(uid), type: str('worming'), title: str('Worming overdue'), dueDate: str(isoDay(-3)), notifyDaysBefore: { integerValue: '7' }, status: str('pending'), createdAt: str(now) })
  await fsCreate('reminders', `${uid}-r3`, { dogId: str(dogIds[0]), tenantId: str(uid), type: str('vet_appointment'), title: str('Vet check done'), dueDate: str(isoDay(-20)), notifyDaysBefore: { integerValue: '7' }, status: str('completed'), completedAt: str(now), createdAt: str(now) })

  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await page.goto('/login', { waitUntil: 'load' })
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\//, { timeout: 30_000 })
  await dismissStateModal(page)

  // ── P2-1: My Dogs at 2/2 — the limit and the plan-aware action are visible BEFORE Add Dog.
  await page.goto('/app/dogs', { waitUntil: 'load' })
  await dismissStateModal(page)
  await expect(page.getByLabel('2 of 2 free plan dogs used')).toBeVisible({ timeout: 20_000 })
  const notice = page.locator('.dog-limit-notice')
  await expect(notice).toContainText('using all 2 dogs on the Free plan')
  await expect(notice).toContainText('documents, QR Passports, reminders and ownership transfer stay free')
  await expect(notice).not.toContainText(/unlock .*documents/i)
  const cta = page.getByRole('link', { name: /Get Plus for A\$0|Upgrade — A\$7\/mo/ })
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute('href', '/app/billing')
  await expect(page.getByRole('link', { name: '+ Add Dog' })).toHaveCount(0)
  const box = (await cta.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.x, 'CTA inside the viewport').toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, 'CTA inside the viewport').toBeLessThanOrEqual(width)
  expect(box.height, 'tap target').toBeGreaterThanOrEqual(32)
  await noHorizontalScroll(page)
  await page.screenshot({ path: info.outputPath('my-dogs-2of2.png'), fullPage: true })

  // Direct URL still guarded, with corrected copy and promo-aware action.
  await page.goto('/app/dogs/new', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Free plan limit reached' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/ownership transfer stay free/)).toBeVisible()
  await expect(page.getByText(/unlock iDogs Scan, documents/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Get Plus for A\$0|Upgrade — A\$7\/mo/ })).toBeVisible()

  // ── P2-2: Reminders opens on Overdue; "All caught up" never shown while overdue exist.
  await page.goto('/app/reminders', { waitUntil: 'load' })
  await expect(page.getByText('C5 booster overdue')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Worming overdue')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Overdue/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/All caught up/)).toHaveCount(0)
  await noHorizontalScroll(page)
  await page.screenshot({ path: info.outputPath('reminders-overdue-default.png'), fullPage: true })
  await page.getByRole('button', { name: /^Upcoming/ }).click()
  await expect(page.getByText('Nothing coming up')).toBeVisible()
  await expect(page.getByText(/All caught up/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show 2 overdue' }).click()
  await expect(page.getByText('C5 booster overdue')).toBeVisible()
  // An explicit link keeps its filter.
  await page.goto('/app/reminders?filter=done', { waitUntil: 'load' })
  await expect(page.getByText('Vet check done')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /^Done/ })).toHaveAttribute('aria-pressed', 'true')

  // ── Regression: 1/2 dogs keeps the normal Add Dog path.
  await fsDelete(`reminders/${uid}-r2`)
  await fsDelete(`dogs/${dogIds[1]}`)
  await page.goto('/app/dogs', { waitUntil: 'load' })
  await expect(page.getByLabel('1 of 2 free plan dogs used')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.dog-limit-notice')).toHaveCount(0)
  await page.getByRole('link', { name: '+ Add Dog' }).click()
  await page.waitForURL(/\/app\/dogs\/new$/)
  await expect(page.getByRole('heading', { name: 'Add Dog' })).toBeVisible({ timeout: 20_000 })
  console.log(`FREE-LIMIT+OVERDUE PASS project=${info.project.name} uid=${uid}`)
})
