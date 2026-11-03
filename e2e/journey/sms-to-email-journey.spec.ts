import { expect, test, type Page } from '@playwright/test'

// Owner priority (02 Nov 2026), PR #77:
//   SMS signup → verify email → add dog → set password → email login
//   → same account keeps its dog and Plus.
// Runs the REAL app UI + REAL api/*.js handlers against the Firebase Auth +
// Firestore emulators (no real SMS, email, payment or cloud project).
const PROJECT = 'demo-idogs-journey'
const AUTH = 'http://127.0.0.1:9099'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const PASSWORD = 'Journey-Password-2026!'

async function accounts() {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=100`, { headers: OWNER })
  return ((await r.json()).users || []) as Array<{ localId: string; phoneNumber?: string; email?: string; emailVerified?: boolean; providerUserInfo?: Array<{ providerId: string }> }>
}
async function smsCode(phone: string) {
  const r = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/verificationCodes`)
  return ((await r.json()).verificationCodes as Array<{ phoneNumber: string; code: string }>).filter(c => c.phoneNumber === phone).pop()!.code
}
async function signInLinkCode(email: string) {
  const r = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)
  return ((await r.json()).oobCodes as Array<{ email: string; requestType: string; oobCode: string }>)
    .filter(c => c.email === email && c.requestType === 'EMAIL_SIGNIN').pop()!.oobCode
}
async function fsGet(path: string) { return (await fetch(`${FS}/${path}`, { headers: OWNER })).json() }
async function fsQuery(collection: string, field: string, value: string) {
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: OWNER, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } }) })
  return ((await r.json()) as Array<{ document?: { name: string; fields: Record<string, { stringValue?: string }> } }>).filter(x => x.document).map(x => x.document!)
}
// Simulates the customer's existing Plus (A$0 promotion) — written as the
// trusted Stripe webhook would (Admin), never by the browser.
async function grantPlus(uid: string) {
  const fields = { plan: { stringValue: 'plus' }, subscriptionStatus: { stringValue: 'active' }, stripeCustomerId: { stringValue: `cus_journey_${uid}` }, stripeSubscriptionId: { stringValue: `sub_journey_${uid}` }, plusPromotion: { stringValue: 'A0_UNTIL_20270131' } }
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&')
  const r = await fetch(`${FS}/users/${uid}?${mask}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) })
  expect(r.ok).toBe(true)
}
async function dismissStateModal(page: Page) {
  const save = page.getByRole('button', { name: 'Save and continue' })
  if (await save.isVisible().catch(() => false)) {
    await page.locator('select.form-select').first().selectOption('SA')
    await save.click()
    await expect(save).toBeHidden()
  }
}

test('SMS signup → verify email → add dog → set password → email login keeps dog + Plus', async ({ page }, info) => {
  test.setTimeout(180_000)
  const n = 900 + info.workerIndex * 10 + (info.project.name.includes('desktop') ? 1 : 0)
  const localPhone = `0400 000 ${n}`, phone = `+61400000${n}`
  const email = `journey-${n}@example.invalid`
  page.on('pageerror', e => console.log('[pageerror]', e.message))

  // 0. Arrive from a Meta ad link (first-touch attribution, first-party only).
  await page.goto('/?utm_source=facebook&utm_medium=paid_social&utm_campaign=journey-qa&ad_id=120000000000001&fbclid=JOURNEY_SECRET_CLICK_ID', { waitUntil: 'load' })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('idogs-acquisition-v1'))).toContain('journey-qa')

  // 1. SMS signup.
  await page.goto('/signup', { waitUntil: 'load' })
  await page.locator('.idogs-auth-tabs').getByRole('button', { name: 'Mobile number' }).click()
  await page.getByLabel('User name').fill('Journey QA')
  await page.getByLabel('Mobile number').fill(localPhone)
  await page.locator('.idogs-auth-consent input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  await expect(page.getByLabel('Verification code')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Verification code').fill(await smsCode(phone))
  await page.getByRole('button', { name: /Verify code and continue|Finish signing in/ }).click()
  await page.waitForURL(/\/app\//, { timeout: 30_000 })
  const created = (await accounts()).find(a => a.phoneNumber === phone)!
  expect(created, 'Firebase user created by SMS signup').toBeTruthy()
  const uid = created.localId
  // First-touch attribution is on the NEW profile; fbclid stored as a boolean only; cleared from the device afterwards.
  await expect.poll(async () => (await fsGet(`users/${uid}`)).fields?.acquisition?.mapValue?.fields?.campaign?.stringValue, { timeout: 15_000 }).toBe('journey-qa')
  const acq = (await fsGet(`users/${uid}`)).fields.acquisition.mapValue.fields
  expect(acq.source.stringValue).toBe('facebook'); expect(acq.medium.stringValue).toBe('paid_social'); expect(acq.adId.stringValue).toBe('120000000000001')
  expect(acq.fbclid.booleanValue).toBe(true); expect(acq.landingPath.stringValue).toBe('/')
  expect(JSON.stringify(acq)).not.toContain('JOURNEY_SECRET_CLICK_ID')
  expect(await page.evaluate(() => localStorage.getItem('idogs-acquisition-v1'))).toBeNull()
  expect(created.email).toBeUndefined()
  await grantPlus(uid)
  await dismissStateModal(page)

  // 2. Add dog is gated on a verified email → /verify-email (live behaviour).
  await page.goto('/app/dogs/new', { waitUntil: 'load' })
  await page.waitForURL(/\/verify-email\?next=%2Fapp%2Fdogs%2Fnew/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Add your email address' })).toBeVisible()

  // 3. Verify email: one-time link (the old verifyBeforeUpdateEmail dead end is gone).
  await page.getByLabel('Your email address').fill(email)
  await page.getByRole('button', { name: /Send verification email/ }).click()
  await expect(page.getByText(/Check your inbox/)).toBeVisible({ timeout: 20_000 })
  expect((await accounts()).find(a => a.localId === uid)!.email, 'not attached before the link is opened').toBeUndefined()
  const link = `/app/settings?addEmail=1&next=${encodeURIComponent('/app/dogs/new')}&mode=signIn&oobCode=${await signInLinkCode(email)}&apiKey=journey&lang=en`
  await page.goto(link, { waitUntil: 'load' })
  await dismissStateModal(page)
  await expect(page.getByText('Email added and verified')).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/app\/settings$/)                       // one-time code removed from the URL
  const afterLink = (await accounts()).find(a => a.localId === uid)!
  expect(afterLink.email).toBe(email); expect(afterLink.emailVerified).toBe(true)

  // 4. Add dog (continue where they left off).
  await page.getByRole('link', { name: 'Continue where you left off' }).click()
  await page.waitForURL(/\/app\/dogs\/new/)
  await dismissStateModal(page)
  await page.getByRole('button', { name: /Skip scan, fill manually/ }).click()
  await page.getByPlaceholder('Luna').fill('Journey Ruby')
  await page.locator('select.form-select').filter({ has: page.locator('option', { hasText: 'Select breed…' }) }).selectOption({ index: 1 })
  await page.locator('input[type="date"]').first().fill('2024-03-01')
  await page.getByRole('button', { name: /^Add Dog/ }).click()
  await page.waitForURL(/\/app\/dogs\/(?!new)[^/]+/, { timeout: 30_000 })
  const dogs = await fsQuery('dogs', 'currentOwnerId', uid)
  expect(dogs, 'dog saved under the SAME uid').toHaveLength(1)
  const dogId = dogs[0].name.split('/').pop()!

  // 5. Set password (back in Settings — the step must still be offered).
  await page.goto('/app/settings', { waitUntil: 'load' })
  await dismissStateModal(page)
  await expect(page.getByText('Step 2 of 2')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('New password').fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByText(/You can now sign in with/)).toBeVisible({ timeout: 20_000 })

  // Profile email synced (reminder emails read profile.email).
  const profile = await fsGet(`users/${uid}`)
  expect(profile.fields.email.stringValue).toBe(email)

  // 6. Sign out → email/password login.
  await page.context().clearCookies()
  await page.evaluate(() => { indexedDB.deleteDatabase('firebaseLocalStorageDb'); localStorage.clear(); sessionStorage.clear() })
  await page.goto('/login', { waitUntil: 'load' })
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\//, { timeout: 30_000 })

  // 7. Same account: dog and Plus kept.
  await page.goto(`/app/dogs/${dogId}`, { waitUntil: 'load' })
  await expect(page.getByText('Journey Ruby').first()).toBeVisible({ timeout: 20_000 })
  const users = await accounts()
  expect(users.filter(a => a.phoneNumber === phone || a.email === email), 'exactly one Firebase user').toHaveLength(1)
  const providers = (users.find(a => a.localId === uid)!.providerUserInfo || []).map(p => p.providerId).sort()
  expect(providers).toEqual(expect.arrayContaining(['password', 'phone']))
  const finalProfile = await fsGet(`users/${uid}`)
  expect(finalProfile.fields.plan.stringValue).toBe('plus')
  expect(finalProfile.fields.stripeSubscriptionId.stringValue).toBe(`sub_journey_${uid}`)
  expect(finalProfile.fields.plusPromotion.stringValue).toBe('A0_UNTIL_20270131')
  await page.goto('/app/settings', { waitUntil: 'load' })
  await expect(page.locator('text=/plus/i >> visible=true').first()).toBeVisible()  // mobile hides the sidebar copy
  console.log(`JOURNEY PASS uid=${uid} dog=${dogId} providers=${providers.join(',')} plan=plus`)
})
