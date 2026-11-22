import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

// LP-11 authenticated isolation QA on a Vercel STAGING Preview (Owner gate 22 Nov 2026:
// staging-only synthetic QA). Two dedicated synthetic QA accounts, never customers:
//   A = Pet owner  (E2E_STAGING_EMAIL / E2E_STAGING_PASSWORD)    one dog "QA-SYNTH A"
//   B = Breeder    (E2E_STAGING_EMAIL_2 / E2E_STAGING_PASSWORD_2) one dog "QA-SYNTH B"
// Fixture contract and setup: docs/growth-v1/QA_SYNTH_FIXTURES.md.
//
// Harness rules (Codex preflight #7075190263):
// - Every context is created explicitly with the configured baseURL and the Vercel Preview
//   protection headers; the base URL must be an idogs-app-staging Preview (or 127.0.0.1 in
//   an explicit harness dry run), and sign-in refuses unless the bundle targets staging.
// - No secret ever reaches the report: tracing, screenshots and video are off for this file;
//   credentials are entered via evaluate() (argument values are not recorded in step titles);
//   assertions on tokens, signed URLs and file paths are boolean, so a failure message never
//   prints them. Nothing is logged.
// Writes: one uniquely-stamped document per account per run (renamed, then deleted in `finally`).

const STAGING_PROJECT = 'idogs-app-staging'
const STAGING_PREVIEW = /^https:\/\/idogs-app-staging-[a-z0-9-]+\.vercel\.app\/?$/
const DRY_RUN_LOCAL = /^http:\/\/127\.0\.0\.1:\d+\/?$/
const A = { name: 'A', email: process.env.E2E_STAGING_EMAIL, password: process.env.E2E_STAGING_PASSWORD, dog: 'QA-SYNTH A' }
const B = { name: 'B', email: process.env.E2E_STAGING_EMAIL_2, password: process.env.E2E_STAGING_PASSWORD_2, dog: 'QA-SYNTH B' }
type Account = typeof A
// Synthetic private values set on B's dog at fixture creation (see the fixture doc).
const B_PRIVATE = ['900000000000002', 'QA-SYNTH-PRIVATE-NOTE-B']
const PUBLIC_KEYS = ['id', 'name', 'breed', 'sex', 'dateOfBirth', 'colour', 'lifeStage', 'profilePhoto', 'passportId', 'status', 'sourceType', 'isDeceased']
const NEVER_PUBLIC = ['microchip', 'ankc', 'notes', 'tenantId', 'currentOwnerId', 'createdByUserId', 'originBreederId', 'buyerEmail', 'buyerName', 'breederId', 'photos', 'videos']
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

type Target = { baseURL: string; extraHTTPHeaders: Record<string, string> }

function target(baseURL: string | undefined, extraHTTPHeaders: Record<string, string> | undefined): Target {
  const base = baseURL || ''
  const ok = STAGING_PREVIEW.test(base) || (process.env.E2E_HARNESS_DRYRUN === '1' && DRY_RUN_LOCAL.test(base))
  expect(ok, 'BASE_URL must be an idogs-app-staging Preview').toBe(true)
  return { baseURL: base.replace(/\/$/, ''), extraHTTPHeaders: extraHTTPHeaders || {} }
}

/** Every context gets the exact Preview baseURL and protection headers (raw newContext() inherits neither). */
const newContext = (browser: Browser, t: Target): Promise<BrowserContext> =>
  browser.newContext({ baseURL: t.baseURL, extraHTTPHeaders: t.extraHTTPHeaders })

async function firebaseProjectOf(page: Page): Promise<string | null> {
  for (const src of await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src))) {
    if (!src.startsWith(new URL(page.url()).origin)) continue
    const m = /projectId:"([a-z0-9-]+)"/.exec(await (await page.request.get(src)).text())
    if (m) return m[1]
  }
  return null
}

/** Set a React-controlled input without the value appearing in the report's step titles. */
async function enterSecretly(page: Page, selector: string, value: string) {
  await page.locator(selector).first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function signIn(browser: Browser, t: Target, who: Account) {
  const context = await newContext(browser, t)
  const page = await context.newPage()
  await page.goto('/login')
  expect(new URL(page.url()).origin, 'navigation stayed on the Preview').toBe(new URL(t.baseURL).origin)
  expect(await firebaseProjectOf(page), 'refuse to sign in unless the bundle targets staging').toBe(STAGING_PROJECT)
  await enterSecretly(page, 'input[type="email"]', who.email!)
  await enterSecretly(page, 'input[type="password"]', who.password!)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page, `account ${who.name} signs in`).toHaveURL(/\/app\//, { timeout: 25_000 })
  return page
}

async function dogList(page: Page) {
  await page.goto('/app/dogs')
  await expect(page.locator('a[href^="/app/dogs/"]').first()).toBeVisible({ timeout: 20_000 })
  return page.locator('main').innerText()
}

/** Open the account's own fixture dog: returns its id and Passport ID. */
async function ownDog(page: Page, who: Account) {
  await page.goto('/app/dogs')
  await page.locator('a[href^="/app/dogs/"]').filter({ hasText: who.dog }).first().click()
  await expect(page).toHaveURL(/\/app\/dogs\/[^/]+$/)
  const id = new URL(page.url()).pathname.split('/').pop()!
  const passport = (await page.locator('div').filter({ has: page.getByText('Passport ID', { exact: true }) }).last().locator('span').last().innerText()).trim()
  return { id, passport }
}

const row = (page: Page, text: string) =>
  page.locator('div').filter({ hasText: text }).filter({ has: page.getByRole('button', { name: /Delete/ }) }).last()

/** Upload a stamped document for the account's fixture dog, View it (capturing the request), then Edit (rename) it. */
async function ownDocumentLifecycle(page: Page, who: Account, stamp: string, renamed: string) {
  await page.goto('/app/documents')
  await page.getByRole('button', { name: '+ Upload Document' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Upload Document' })
  const select = dialog.getByLabel('Dog')
  const value = await select.locator('option').evaluateAll((os, n) => (os as HTMLOptionElement[]).find(o => o.textContent?.includes(n))?.value || '', who.dog)
  expect(value !== '', `fixture dog "${who.dog}" present in account ${who.name}`).toBe(true)
  await select.selectOption(value)
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'qa-synth.png', mimeType: 'image/png', buffer: PNG })
  await dialog.getByPlaceholder(/^e\.g\. /).first().fill(stamp)
  await dialog.getByRole('button', { name: 'Upload Document' }).click()
  await expect(page.getByText(stamp, { exact: true })).toBeVisible({ timeout: 30_000 })

  // View: the owner gets a signed URL (200).
  const req = page.waitForRequest(r => r.url().includes('/api/get-signed-url'))
  const res = page.waitForResponse(r => r.url().includes('/api/get-signed-url'))
  const popup = page.context().waitForEvent('page').catch(() => null)
  await row(page, stamp).getByRole('button', { name: /View/ }).click()
  const request = await req
  expect((await res).status(), `account ${who.name} can view its own document`).toBe(200)
  await (await popup)?.close()
  const filePath = String(JSON.parse(request.postData() || '{}').filePath || '')
  const auth = request.headers()['authorization'] || ''
  expect(filePath.startsWith('documents/'), 'own document has a private storage path').toBe(true)
  expect(auth.startsWith('Bearer '), 'own View request carries an ID token').toBe(true)

  // Edit: rename persists across reload.
  await row(page, stamp).getByRole('button', { name: 'Edit' }).click()
  await page.locator('#document-edit-name').fill(renamed)
  await page.getByRole('dialog', { name: 'Edit document' }).getByRole('button', { name: 'Save' }).click()
  await page.reload()
  await expect(page.getByText(renamed, { exact: true }), `account ${who.name} edit persists`).toBeVisible({ timeout: 20_000 })
  return { filePath, auth }
}

async function deleteDoc(page: Page, names: string[]) {
  await page.goto('/app/documents')
  for (const name of names) {
    const r = row(page, name)
    if (!(await r.count())) continue
    page.once('dialog', d => d.accept())
    await r.getByRole('button', { name: /Delete/ }).click()
    await expect(page.getByText(name, { exact: true })).toHaveCount(0)
  }
}

/** viewer must not see owner's document or dog, and viewer's token must not get owner's file. */
async function assertIsolated(viewer: Page, viewerAuth: string, owner: Account, ownerDocName: string, ownerDogId: string, ownerFilePath: string) {
  await viewer.goto('/app/documents')
  await expect(viewer.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 20_000 })
  expect(await viewer.getByText(ownerDocName, { exact: true }).count(), `other account cannot list ${owner.name}'s document`).toBe(0)
  await viewer.goto(`/app/dogs/${ownerDogId}`)
  await viewer.waitForTimeout(4000)
  expect((await viewer.locator('main').innerText()).includes(owner.dog), `other account opening ${owner.name}'s dog URL sees no ${owner.name} dog`).toBe(false)

  const post = (headers: Record<string, string>) => viewer.request.post('/api/get-signed-url', { headers, data: { filePath: ownerFilePath } })
  const wrongOwner = await post({ Authorization: viewerAuth })
  expect(wrongOwner.status(), `valid token of another account -> 403 for ${owner.name}'s file`).toBe(403)
  expect(/X-Goog-Signature|storage\.googleapis\.com|firebasestorage/i.test(await wrongOwner.text()), 'no signed URL in the denial body').toBe(false)
  expect((await post({})).status(), 'no token -> 401').toBe(401)
  expect((await post({ Authorization: 'Bearer not-a-real-token' })).status(), 'malformed token -> 401').toBe(401)
}

test.describe('LP-11 two-account isolation + QR privacy (staging synthetic fixtures)', () => {
  test.skip(!A.email || !A.password || !B.email || !B.password, 'Two staging QA accounts not configured (see docs/growth-v1/QA_SYNTH_FIXTURES.md)')
  test.describe.configure({ mode: 'serial' })

  test('owner/breeder login, owned CRUD, mutual isolation, signed URL denial, QR public fields only', async ({ browser, baseURL, extraHTTPHeaders }, info) => {
    const t = target(baseURL, extraHTTPHeaders)
    const run = `${info.project.name} ${Date.now()}`
    const docA = { stamp: `QA-SYNTH A doc ${run}`, renamed: `QA-SYNTH A doc ${run} renamed` }
    const docB = { stamp: `QA-SYNTH B doc ${run}`, renamed: `QA-SYNTH B doc ${run} renamed` }
    const pageA = await signIn(browser, t, A)
    const pageB = await signIn(browser, t, B)
    try {
      // 1. Each account sees only its own synthetic dog.
      const listA = await dogList(pageA)
      expect(listA.includes(A.dog) && !listA.includes(B.dog), 'A lists only its own dog').toBe(true)
      const listB = await dogList(pageB)
      expect(listB.includes(B.dog) && !listB.includes(A.dog), 'B lists only its own dog').toBe(true)
      const dogA = await ownDog(pageA, A)
      const dogB = await ownDog(pageB, B)
      expect(/^[A-Z0-9-]{6,}$/.test(dogB.passport), 'B fixture dog has a passport ID').toBe(true)

      // 2. Owned Documents: upload, View (200), Edit (persists).
      const a = await ownDocumentLifecycle(pageA, A, docA.stamp, docA.renamed)
      const b = await ownDocumentLifecycle(pageB, B, docB.stamp, docB.renamed)

      // 3. Mutual isolation: A→B and B→A (UI listing, dog URL, signed URL with wrong/no/malformed token).
      await assertIsolated(pageA, a.auth, B, docB.renamed, dogB.id, b.filePath)
      await assertIsolated(pageB, b.auth, A, docA.renamed, dogA.id, a.filePath)

      // 4. Anonymous QR passport (Preview protection headers only, no app session).
      const anon = await newContext(browser, t)
      try {
        const api = await anon.request.get(`/api/passport?passportId=${encodeURIComponent(dogB.passport)}`)
        expect(api.status(), 'public passport API reachable anonymously').toBe(200)
        const body = await api.json()
        expect(Object.keys(body).sort()).toEqual(['dog', 'healthTests', 'vaccines'])
        for (const k of Object.keys(body.dog)) expect(PUBLIC_KEYS, `unexpected public field ${k}`).toContain(k)
        for (const k of NEVER_PUBLIC) expect(k in body.dog, `private field ${k} not exposed`).toBe(false)
        expect(String(body.dog.name).includes(B.dog), 'passport is B fixture dog').toBe(true)
        const raw = JSON.stringify(body)
        const secretsB = [...B_PRIVATE, B.email!, docB.stamp, docB.renamed, b.filePath]
        expect(secretsB.some(v => raw.includes(v)), 'no private value in passport API').toBe(false)
        const qr = await anon.newPage()
        await qr.goto(`/p/${encodeURIComponent(dogB.passport)}`)
        await expect(qr.getByText(B.dog).first()).toBeVisible({ timeout: 20_000 })
        const text = await qr.locator('body').innerText()
        expect(secretsB.some(v => text.includes(v)), 'no private value on public QR page').toBe(false)
      } finally {
        await anon.close()
      }
    } finally {
      await deleteDoc(pageA, [docA.renamed, docA.stamp]).catch(() => {})
      await deleteDoc(pageB, [docB.renamed, docB.stamp]).catch(() => {})
      await pageA.context().close()
      await pageB.context().close()
    }
  })
})
