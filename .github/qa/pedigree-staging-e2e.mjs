import fs from 'node:fs'
import crypto from 'node:crypto'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const FIXTURE_PATH = '/tmp/pedigree-fixture.json'
const mode = process.argv[2]

function assert(ok, message) {
  if (!ok) throw new Error(message)
}

function assertStagingBoundary() {
  assert(process.env.FIREBASE_PROJECT_ID === 'idogs-app-staging', `Refusing Firebase target: ${process.env.FIREBASE_PROJECT_ID || 'missing'}`)
  assert(process.env.VITE_FIREBASE_PROJECT_ID === 'idogs-app-staging', `Refusing Vite Firebase target: ${process.env.VITE_FIREBASE_PROJECT_ID || 'missing'}`)
  assert(process.env.FIREBASE_CLIENT_EMAIL, 'FIREBASE_CLIENT_EMAIL missing')
  assert(String(process.env.FIREBASE_PRIVATE_KEY || '').includes('PRIVATE KEY'), 'FIREBASE_PRIVATE_KEY missing')
}

function adminApp(label) {
  assertStagingBoundary()
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n'),
    }),
  }, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

async function setup() {
  assertStagingBoundary()
  const app = adminApp('pedigree-setup')
  const auth = getAuth(app)
  const db = getFirestore(app)
  const key = String(process.env.QA_RUN_KEY || Date.now()).replace(/[^A-Za-z0-9-]/g, '-')
  const email = `pedigree.qa.${key}@example.com`
  const password = `Qa!${crypto.randomBytes(18).toString('base64url')}9z`
  const created = await auth.createUser({ email, password, emailVerified: true, displayName: 'Pedigree QA' })
  const uid = created.uid
  const now = new Date().toISOString()
  const dogId = `qa-pedigree-dog-${key}`
  const litterId = `qa-pedigree-litter-${key}`
  const puppySpecs = [
    ['no_pedigree', 'QA No Pedigree'],
    ['mixed', 'QA Mixed'],
    ['rescue', 'QA Rescue'],
    ['not_recorded', 'QA Not Recorded'],
    [null, 'QA Missing Registration'],
  ]
  const puppies = puppySpecs.map(([reg, label], index) => ({
    id: `qa-pedigree-puppy-${index}-${key}`,
    reg,
    name: `${label} ${key}`,
  }))
  const fixture = {
    uid,
    email,
    password,
    dogId,
    litterId,
    dogName: `QA Pedigree Dog ${key}`,
    litterName: `QA Pedigree Litter ${key}`,
    puppies,
  }
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture), { mode: 0o600 })

  await db.doc(`users/${uid}`).set({
    uid,
    email,
    name: 'Pedigree QA',
    displayName: 'Pedigree QA',
    role: 'breeder',
    accountType: 'breeder',
    activeWorkspace: 'breeder',
    state: 'SA',
    plan: 'free',
    internalEntitlement: {
      granted: true,
      grantedAt: now,
      grantedBy: 'pedigree-staging-e2e',
      reason: 'Disposable staging QA',
      expiresAt: null,
    },
    createdAt: now,
    updatedAt: now,
  })

  const baseDog = {
    tenantId: uid,
    breed: 'Labrador Retriever',
    colour: 'Black',
    microchip: '',
    ankc: '',
    isDeceased: false,
    originBreederId: uid,
    currentOwnerId: uid,
    sourceType: 'BREEDER_ISSUED',
    createdByUserId: uid,
    photos: [],
    notes: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await db.doc(`dogs/${dogId}`).set({
    ...baseDog,
    passportId: `QAPED${key.replaceAll('-', '').slice(-12).toUpperCase()}`,
    name: fixture.dogName,
    sex: 'female',
    dateOfBirth: '2020-01-01',
    lifeStage: 'adult',
    pedigreeRegister: 'no_pedigree',
    breedingEligibility: 'unknown',
    breederIdType: 'NONE',
  })

  for (const [index, puppy] of puppies.entries()) {
    const data = {
      ...baseDog,
      passportId: `QAPUP${index}${key.replaceAll('-', '').slice(-10).toUpperCase()}`,
      name: puppy.name,
      sex: index % 2 ? 'male' : 'female',
      dateOfBirth: '2026-06-01',
      lifeStage: 'puppy',
      litterId,
      retainedByBreeder: false,
      breedingEligibility: 'unknown',
    }
    if (puppy.reg !== null) data.pedigreeRegister = puppy.reg
    await db.doc(`dogs/${puppy.id}`).set(data)
  }

  await db.doc(`litters/${litterId}`).set({
    tenantId: uid,
    name: fixture.litterName,
    damId: dogId,
    damName: fixture.dogName,
    notes: '',
    actualBirthDate: '2026-06-01',
    puppyIds: puppies.map(p => p.id),
    createdAt: now,
    archived: false,
  })

  await deleteApp(app)
  console.log('DISPOSABLE_FIXTURE_READY', JSON.stringify({ uid, dogId, litterId, puppyCount: puppies.length }))
}

async function e2e() {
  assertStagingBoundary()
  assert(process.env.BASE_URL, 'BASE_URL missing')
  assert(process.env.CHROME_PATH, 'CHROME_PATH missing')
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const { chromium } = await import('playwright-core')
  const app = adminApp('pedigree-e2e')
  const db = getFirestore(app)
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  async function waitDog(expectedRegister, expectedEligibility) {
    for (let i = 0; i < 40; i++) {
      const data = (await db.doc(`dogs/${fixture.dogId}`).get()).data() || {}
      if (data.pedigreeRegister === expectedRegister && data.breedingEligibility === expectedEligibility) return
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const data = (await db.doc(`dogs/${fixture.dogId}`).get()).data() || {}
    throw new Error(`Firestore pedigree mismatch: expected ${expectedRegister}/${expectedEligibility}, got ${data.pedigreeRegister}/${data.breedingEligibility}`)
  }

  function pedigreeSelect(scope = page) {
    return scope.locator('select').filter({ has: scope.locator('option[value="rescue"]') })
  }

  const base = process.env.BASE_URL
  await page.goto(`${base}/login?next=${encodeURIComponent(`/app/dogs/${fixture.dogId}`)}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.getByLabel('Email address').fill(fixture.email)
  await page.getByLabel('Password').fill(fixture.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`**/app/dogs/${fixture.dogId}`, { timeout: 45000 })
  await page.getByRole('heading', { name: fixture.dogName }).waitFor({ state: 'visible', timeout: 30000 })

  let overviewSelect = pedigreeSelect(page).first()
  assert(await overviewSelect.inputValue() === 'no_pedigree', 'Overview must start as no_pedigree')
  const transitions = [
    ['limited', 'not_eligible'],
    ['main', 'unknown'],
    ['not_recorded', 'unknown'],
    ['mixed', 'unknown'],
    ['rescue', 'unknown'],
    ['no_pedigree', 'unknown'],
  ]
  for (const [register, eligibility] of transitions) {
    await overviewSelect.selectOption(register)
    await waitDog(register, eligibility)
    overviewSelect = pedigreeSelect(page).first()
    assert(await overviewSelect.inputValue() === register, `Overview UI did not retain ${register}`)
  }
  console.log('OVERVIEW_REAL_FIRESTORE_TRANSITIONS_PASS')

  await page.getByRole('button', { name: /Transfer/ }).first().click()
  await page.getByText('Transfer Ownership', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  let allPedigreeSelects = pedigreeSelect(page)
  assert(await allPedigreeSelects.count() >= 2, 'Dog Detail transfer pedigree select not found')
  assert(await allPedigreeSelects.last().inputValue() === 'no_pedigree', 'Dog Detail transfer modal reclassified no_pedigree')
  await page.getByRole('button', { name: '✕' }).last().click()
  console.log('DOG_DETAIL_TRANSFER_PREFILL_PASS')

  await page.goto(`${base}/app/litters`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const litterTitle = page.getByText(fixture.litterName, { exact: true }).first()
  await litterTitle.waitFor({ state: 'visible', timeout: 30000 })
  await litterTitle.click()
  await page.getByText(fixture.puppies[0].name, { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 })

  for (const puppy of fixture.puppies) {
    const expected = puppy.reg ?? 'not_recorded'
    const nameNode = page.getByText(puppy.name, { exact: true }).first()
    const row = nameNode.locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Transfer")]][1]')
    await row.getByRole('button', { name: /Transfer/ }).click()
    await page.getByText('Transfer Ownership', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    const modalSelect = pedigreeSelect(page).last()
    assert(await modalSelect.inputValue() === expected, `Litter transfer modal reclassified ${puppy.name}: expected ${expected}`)
    await page.getByRole('button', { name: '✕' }).last().click()
  }
  console.log('LITTER_TRANSFER_ALL_REGISTRATION_PREFILLS_PASS')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/app/dogs/${fixture.dogId}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.getByRole('heading', { name: fixture.dogName }).waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: /Transfer/ }).first().click()
  await page.getByText('Transfer Ownership', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const mobileSelect = pedigreeSelect(page).last()
  assert(await mobileSelect.isVisible(), 'Mobile transfer pedigree select is not visible')
  assert(await mobileSelect.inputValue() === 'no_pedigree', 'Mobile transfer pedigree value changed')
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  assert(!mobileOverflow, 'Horizontal overflow detected at 390px viewport')
  console.log('MOBILE_PEDIGREE_MODAL_PASS')

  await page.setViewportSize({ width: 1440, height: 900 })
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  assert(!desktopOverflow, 'Horizontal overflow detected at desktop viewport')
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`)

  const finalDog = (await db.doc(`dogs/${fixture.dogId}`).get()).data() || {}
  assert(finalDog.pedigreeRegister === 'no_pedigree' && finalDog.breedingEligibility === 'unknown', 'Final persisted pedigree state is wrong')
  console.log('PEDIGREE_E2E_PASS', JSON.stringify({ finalRegister: finalDog.pedigreeRegister, finalEligibility: finalDog.breedingEligibility }))

  await page.close()
  await browser.close()
  await deleteApp(app)
}

async function cleanup() {
  assertStagingBoundary()
  const app = adminApp('pedigree-cleanup')
  const auth = getAuth(app)
  const db = getFirestore(app)
  const key = String(process.env.QA_RUN_KEY || '').replace(/[^A-Za-z0-9-]/g, '-')
  const fallbackEmail = `pedigree.qa.${key}@example.com`
  let fixture = null
  try { fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) } catch {}
  let uid = fixture?.uid || null
  if (!uid && key) {
    try { uid = (await auth.getUserByEmail(fallbackEmail)).uid } catch {}
  }

  const refs = []
  if (fixture) {
    refs.push(db.doc(`dogs/${fixture.dogId}`), db.doc(`litters/${fixture.litterId}`))
    for (const puppy of fixture.puppies || []) refs.push(db.doc(`dogs/${puppy.id}`))
  }
  if (uid) {
    for (const collectionName of ['auditLogs', 'activityNotes', 'reminders', 'documents']) {
      const snap = await db.collection(collectionName).where('tenantId', '==', uid).get().catch(() => null)
      if (snap) for (const doc of snap.docs) refs.push(doc.ref)
    }
    refs.push(db.doc(`users/${uid}`))
  }

  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch()
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref)
    await batch.commit()
  }
  if (uid) await auth.deleteUser(uid).catch(() => {})
  await deleteApp(app)
  console.log('DISPOSABLE_FIXTURE_CLEANUP_PASS')
}

if (mode === 'setup') await setup()
else if (mode === 'e2e') await e2e()
else if (mode === 'cleanup') await cleanup()
else throw new Error(`Unknown mode: ${mode}`)
