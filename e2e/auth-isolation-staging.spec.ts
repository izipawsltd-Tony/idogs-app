import { expect, test, type Browser, type Page } from '@playwright/test'

// LP-11 authenticated isolation QA on a Vercel STAGING Preview (Owner gate 22 Nov 2026:
// staging-only synthetic QA). Two dedicated synthetic QA accounts, never customers:
//   A = Pet owner  (E2E_STAGING_EMAIL / E2E_STAGING_PASSWORD)    one dog "QA-SYNTH A"
//   B = Breeder    (E2E_STAGING_EMAIL_2 / E2E_STAGING_PASSWORD_2) one dog "QA-SYNTH B"
// Fixture contract and setup: docs/growth-v1/QA_SYNTH_FIXTURES.md.
// Writes: only one uniquely-stamped document per account per run, deleted in `finally`.
// Credentials and ID tokens are only held in memory; nothing secret is logged or attached.

const STAGING_PROJECT = 'idogs-app-staging'
const A = { email: process.env.E2E_STAGING_EMAIL, password: process.env.E2E_STAGING_PASSWORD, dog: 'QA-SYNTH A' }
const B = { email: process.env.E2E_STAGING_EMAIL_2, password: process.env.E2E_STAGING_PASSWORD_2, dog: 'QA-SYNTH B' }
// Synthetic private values set on B's dog at fixture creation (see the fixture doc).
const B_PRIVATE = ['900000000000002', 'QA-SYNTH-PRIVATE-NOTE-B']
const PUBLIC_KEYS = ['id', 'name', 'breed', 'sex', 'dateOfBirth', 'colour', 'lifeStage', 'profilePhoto', 'passportId', 'status', 'sourceType', 'isDeceased']
const NEVER_PUBLIC = ['microchip', 'ankc', 'notes', 'tenantId', 'currentOwnerId', 'createdByUserId', 'originBreederId', 'buyerEmail', 'buyerName', 'breederId', 'photos', 'videos']
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function firebaseProjectOf(page: Page): Promise<string | null> {
  for (const src of await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src))) {
    if (!src.startsWith(new URL(page.url()).origin)) continue
    const m = /projectId:"([a-z0-9-]+)"/.exec(await (await page.request.get(src)).text())
    if (m) return m[1]
  }
  return null
}

async function signIn(browser: Browser, who: typeof A) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  expect(await firebaseProjectOf(page), 'refuse to sign in unless the bundle targets staging').toBe(STAGING_PROJECT)
  await page.locator('input[type="email"]').first().fill(who.email!)
  await page.locator('input[type="password"]').first().fill(who.password!)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/\/app\//, { timeout: 25_000 })
  return page
}

async function dogList(page: Page) {
  await page.goto('/app/dogs')
  await expect(page.locator('a[href^="/app/dogs/"]').first()).toBeVisible({ timeout: 20_000 })
  return page.locator('main').innerText()
}

const row = (page: Page, text: string) =>
  page.locator('div').filter({ hasText: text }).filter({ has: page.getByRole('button', { name: /Delete/ }) }).last()

/** Upload a stamped document for the account's synthetic dog; View it and capture the request. */
async function uploadAndView(page: Page, dogName: string, stamp: string) {
  await page.goto('/app/documents')
  await page.getByRole('button', { name: '+ Upload Document' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Upload Document' })
  const select = dialog.getByLabel('Dog')
  const value = await select.locator('option').evaluateAll((os, n) => (os as HTMLOptionElement[]).find(o => o.textContent?.includes(n))?.value || '', dogName)
  expect(value, `fixture dog "${dogName}" missing from this account`).not.toBe('')
  await select.selectOption(value)
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'qa-synth.png', mimeType: 'image/png', buffer: PNG })
  await dialog.getByPlaceholder(/^e\.g\. /).first().fill(stamp)
  await dialog.getByRole('button', { name: 'Upload Document' }).click()
  await expect(page.getByText(stamp, { exact: true })).toBeVisible({ timeout: 30_000 })
  const req = page.waitForRequest(r => r.url().includes('/api/get-signed-url'))
  const res = page.waitForResponse(r => r.url().includes('/api/get-signed-url'))
  const popup = page.context().waitForEvent('page').catch(() => null)
  await row(page, stamp).getByRole('button', { name: /View/ }).click()
  const request = await req
  expect((await res).status(), 'owner can view own document').toBe(200)
  await (await popup)?.close()
  return { filePath: JSON.parse(request.postData() || '{}').filePath as string, auth: request.headers()['authorization'] || '' }
}

async function deleteDoc(page: Page, stamp: string) {
  await page.goto('/app/documents')
  const r = row(page, stamp)
  if (!(await r.count())) return
  page.once('dialog', d => d.accept())
  await r.getByRole('button', { name: /Delete/ }).click()
  await expect(page.getByText(stamp, { exact: true })).toHaveCount(0)
}

test.describe('LP-11 two-account isolation + QR privacy (staging synthetic fixtures)', () => {
  test.skip(!A.email || !A.password || !B.email || !B.password, 'Two staging QA accounts not configured (see docs/growth-v1/QA_SYNTH_FIXTURES.md)')
  test.describe.configure({ mode: 'serial' })

  test('owner/breeder login, record isolation, signed URL denial, QR public fields only', async ({ browser }, info) => {
    const stampA = `QA-SYNTH A doc ${info.project.name} ${Date.now()}`
    const stampB = `QA-SYNTH B doc ${info.project.name} ${Date.now()}`
    const pageB = await signIn(browser, B)
    const pageA = await signIn(browser, A)
    try {
      // 1. Each account sees only its own synthetic dog.
      const listB = await dogList(pageB)
      expect(listB).toContain(B.dog)
      expect(listB).not.toContain(A.dog)
      const listA = await dogList(pageA)
      expect(listA).toContain(A.dog)
      expect(listA).not.toContain(B.dog)

      // 2. B's dog: id and Passport ID (from B's own detail page).
      await pageB.goto('/app/dogs')
      await pageB.locator('a[href^="/app/dogs/"]').filter({ hasText: B.dog }).first().click()
      await expect(pageB).toHaveURL(/\/app\/dogs\/[^/]+$/)
      const dogIdB = new URL(pageB.url()).pathname.split('/').pop()!
      const passportId = (await pageB.locator('div').filter({ has: pageB.getByText('Passport ID', { exact: true }) }).last().locator('span').last().innerText()).trim()
      expect(passportId, 'B fixture dog has a passport ID').toMatch(/^[A-Z0-9-]{6,}$/)

      // 3. Each account can view its own document; capture B's file path and A's token (memory only).
      const b = await uploadAndView(pageB, B.dog, stampB)
      const a = await uploadAndView(pageA, A.dog, stampA)
      expect(b.filePath).toMatch(/^documents\//)
      expect(a.auth).toMatch(/^Bearer /)

      // 4. A cannot see B's records in the UI.
      await pageA.goto('/app/documents')
      await expect(pageA.getByText(stampA, { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(pageA.getByText(stampB, { exact: true })).toHaveCount(0)
      await pageA.goto(`/app/dogs/${dogIdB}`)
      await pageA.waitForTimeout(4000)
      expect(await pageA.locator('main').innerText(), "A opening B's dog URL must not show B's dog").not.toContain(B.dog)

      // 5. A's valid token cannot get a signed URL for B's file (server-side ownership check).
      const denied = await pageA.request.post('/api/get-signed-url', { headers: { Authorization: a.auth }, data: { filePath: b.filePath } })
      expect(denied.status(), 'cross-account signed URL must be refused (403: not authorised for this dog)').toBe(403)
      expect(await denied.text()).not.toMatch(/https:\/\/storage|X-Goog-Signature/i)
      // And no token at all is refused.
      expect((await pageA.request.post('/api/get-signed-url', { data: { filePath: b.filePath } })).status()).toBe(401)

      // 6. Anonymous QR passport: allowlisted fields only, private values never rendered.
      const anon = await browser.newContext()
      try {
        const api = await anon.request.get(`/api/passport?passportId=${encodeURIComponent(passportId)}`)
        expect(api.status()).toBe(200)
        const body = await api.json()
        expect(Object.keys(body).sort()).toEqual(['dog', 'healthTests', 'vaccines'])
        for (const k of Object.keys(body.dog)) expect(PUBLIC_KEYS, `unexpected public field ${k}`).toContain(k)
        for (const k of NEVER_PUBLIC) expect(body.dog, `private field ${k} exposed`).not.toHaveProperty(k)
        expect(body.dog.name).toContain(B.dog)
        const raw = JSON.stringify(body)
        for (const v of [...B_PRIVATE, B.email!, stampB, b.filePath]) expect(raw.includes(v), 'private value in passport API').toBe(false)
        const qr = await anon.newPage()
        await qr.goto(`/p/${encodeURIComponent(passportId)}`)
        await expect(qr.getByText(B.dog).first()).toBeVisible({ timeout: 20_000 })
        const text = await qr.locator('body').innerText()
        for (const v of [...B_PRIVATE, B.email!, stampB]) expect(text.includes(v), 'private value on public QR page').toBe(false)
      } finally {
        await anon.close()
      }
    } finally {
      await deleteDoc(pageA, stampA).catch(() => {})
      await deleteDoc(pageB, stampB).catch(() => {})
      await pageA.context().close()
      await pageB.context().close()
    }
  })
})
