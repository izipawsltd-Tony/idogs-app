import { expect, test, type Browser, type Page } from '@playwright/test'
import { assertStagingPreview, createPreviewContext } from './support/previewContext'
import { MISSING_REASON, QA_A, QA_B, loadDogCards, provisionQaFixture, signInQa, type QaAccount } from './support/qaFixtures'

// LP-11 authenticated isolation QA on a Vercel STAGING Preview (Owner gate 22 Nov 2026:
// staging-only synthetic QA). Two dedicated synthetic QA accounts, never customers:
//   A = Pet owner  (E2E_STAGING_EMAIL / E2E_STAGING_PASSWORD)    one dog "QA-SYNTH A"
//   B = Breeder    (E2E_STAGING_EMAIL_2 / E2E_STAGING_PASSWORD_2) one dog "QA-SYNTH B"
// Fixture contract and setup: docs/growth-v1/QA_SYNTH_FIXTURES.md.
//
// Harness rules (Codex preflight #7075190263):
// - Every context is created via createPreviewContext: exact Preview baseURL; the Vercel bypass
//   secret is sent once to the exact Preview origin to obtain a host-only cookie, never as a
//   context-wide header (Codex #7077157877; proven by preview-context-sentinel.spec.ts). The
//   base URL must be an idogs-app-staging Preview and sign-in refuses unless the bundle
//   targets staging.
// - No secret ever reaches the report: tracing, screenshots and video are off for this file;
//   credentials are entered via evaluate() (argument values are not recorded in step titles);
//   assertions on tokens, signed URLs and file paths are boolean, so a failure message never
//   prints them. Nothing is logged.
// Writes: one uniquely-stamped document per account per run (renamed, then deleted in `finally`).

const A = QA_A
const B = QA_B
type Account = QaAccount
// Synthetic private values set on B's dog at fixture creation (see the fixture doc).
const B_PRIVATE = ['900000000000002', 'QA-SYNTH-PRIVATE-NOTE-B']
const PUBLIC_KEYS = ['id', 'name', 'breed', 'sex', 'dateOfBirth', 'colour', 'lifeStage', 'profilePhoto', 'passportId', 'status', 'sourceType', 'isDeceased']
const NEVER_PUBLIC = ['microchip', 'ankc', 'notes', 'tenantId', 'currentOwnerId', 'createdByUserId', 'originBreederId', 'buyerEmail', 'buyerName', 'breederId', 'photos', 'videos']
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test.use({ trace: 'off', screenshot: 'off', video: 'off', extraHTTPHeaders: {} })
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

type Target = { baseURL: string }
const target = (baseURL: string | undefined): Target => ({ baseURL: assertStagingPreview(baseURL) })
const newContext = (browser: Browser, t: Target) => createPreviewContext(browser, t.baseURL, BYPASS)

const signIn = (browser: Browser, t: Target, who: Account) => signInQa(browser, t.baseURL, who)

async function dogList(page: Page) {
  return (await loadDogCards(page)).join('\n')
}

/** Open the account's own fixture dog: returns its id and Passport ID. */
async function ownDog(page: Page, who: Account) {
  await page.goto('/app/dogs')
  await page.locator('a[href^="/app/dogs/"]:not([href="/app/dogs/new"])').filter({ hasText: who.dog }).first().click()
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

  // Edit: wait for verifiable Save completion before reloading. DocumentsPage closes the dialog
  // and shows the new name only after updateDoc() resolves (server acknowledgement); reloading
  // earlier can abort the write (Codex #7078976320). Then assert persistence after reload.
  await row(page, stamp).getByRole('button', { name: 'Edit' }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit document' })
  await page.locator('#document-edit-name').fill(renamed)
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(editDialog, `account ${who.name} edit saved (dialog closed)`).toBeHidden({ timeout: 20_000 })
  await expect(page.getByText(renamed, { exact: true }), `account ${who.name} renamed document shown after save`).toBeVisible({ timeout: 10_000 })
  expect(await page.getByText('Failed to update document').count(), 'no update failure toast').toBe(0)
  await page.reload()
  await expect(page.getByText(renamed, { exact: true }), `account ${who.name} edit persists`).toBeVisible({ timeout: 20_000 })
  return { filePath, auth }
}

/** Teardown: delete this run's own documents. Waits for the list to render (counting right after
 *  navigation could skip silently). Returns how many were deleted. */
async function deleteDoc(page: Page, names: string[]) {
  await page.goto('/app/documents')
  await expect(page.getByRole('button', { name: '+ Upload Document' }).first()).toBeVisible({ timeout: 20_000 })
  let deleted = 0
  for (const name of names) {
    const present = await page.getByText(name, { exact: true }).first().waitFor({ timeout: 8_000 }).then(() => true, () => false)
    if (!present) continue
    page.once('dialog', d => d.accept())
    await row(page, name).getByRole('button', { name: /Delete/ }).click()
    await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
    deleted++
  }
  return deleted
}

/** Delete this account's OWN leftover temporary LP-11 documents ("QA-SYNTH <A|B> doc …") from
 *  earlier interrupted runs. Exact own-prefix only; never touches any other document. */
async function sweepStaleQaDocs(page: Page, who: Account) {
  const prefix = new RegExp(`^QA-SYNTH ${who.name} doc `)
  await page.goto('/app/documents')
  await expect(page.getByRole('button', { name: '+ Upload Document' }).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500) // let the list render
  for (let i = 0; i < 20; i++) {
    const stale = page.getByText(prefix).first()
    if (!(await stale.count())) return i
    const name = (await stale.innerText()).trim()
    expect(prefix.test(name), 'sweep only own QA-SYNTH temporary documents').toBe(true)
    page.once('dialog', d => d.accept())
    await row(page, name).getByRole('button', { name: /Delete/ }).click()
    await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
  }
  return 20
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

  // Fixture setup through the normal UI as each QA user (idempotent; see support/qaFixtures.ts).
  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(180_000)
    const base = assertStagingPreview(baseURL)
    const a = await provisionQaFixture(browser, base, A)
    const b = await provisionQaFixture(browser, base, B)
    test.skip(a === 'missing' || b === 'missing', MISSING_REASON)
  })

  test('owner/breeder login, owned CRUD, mutual isolation, signed URL denial, QR public fields only', async ({ browser, baseURL }, info) => {
    // Two accounts, two document lifecycles, reciprocal checks, QR and teardown: the 45 s
    // default left no teardown budget (Codex #7078976320).
    test.setTimeout(300_000)
    const t = target(baseURL)
    const run = `${info.project.name} ${Date.now()}`
    const docA = { stamp: `QA-SYNTH A doc ${run}`, renamed: `QA-SYNTH A doc ${run} renamed` }
    const docB = { stamp: `QA-SYNTH B doc ${run}`, renamed: `QA-SYNTH B doc ${run} renamed` }
    const pageA = await signIn(browser, t, A)
    const pageB = await signIn(browser, t, B)
    try {
      await sweepStaleQaDocs(pageA, A)
      await sweepStaleQaDocs(pageB, B)

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
      // Teardown outcome is recorded (not thrown, so the original failure stays visible);
      // anything left behind is removed by the next run's sweepStaleQaDocs().
      for (const [pg, d, who] of [[pageA, docA, A], [pageB, docB, B]] as const) {
        const outcome = await deleteDoc(pg, [d.renamed, d.stamp]).then(n => `deleted ${n}`, () => 'INCOMPLETE')
        info.annotations.push({ type: 'teardown', description: `account ${who.name}: ${outcome}` })
      }
      await pageA.context().close()
      await pageB.context().close()
    }
  })
})
