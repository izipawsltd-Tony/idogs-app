// Regression coverage for the owner/breeder role-persistence fix in
// src/lib/db.ts (normalizeUserProfile + updateUserProfile's role
// write-verification).
//
// db.ts can't be real-imported directly (it transitively imports
// src/lib/firebase.ts, which reads import.meta.env.VITE_FIREBASE_* —
// Vite-only, not defined under plain Node). Instead, this test mirrors the
// exact normalizeUserProfile/updateUserProfile logic against a REAL
// Firestore + Auth emulator round-trip (own client SDK app instance, same
// established pattern as test-scan-count-api.mjs), so persistence-after-
// refresh/re-login is verified against genuine writes/reads, not a mock.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-user-profile-role.mjs

const { initializeApp } = await import('firebase/app')
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore')
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import('firebase/auth')
const { readFileSync } = await import('node:fs')

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'user-profile-role-test')
const db = getFirestore(app)
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Exact mirror of db.ts's normalizeUserProfile (see the precedence
// comment there for the full policy rationale) ──
function isValidRole(v) {
  return v === 'breeder' || v === 'owner' || v === 'admin'
}
function isValidLegacyRole(v) {
  return v === 'breeder' || v === 'owner'
}
function evaluateAccountType(raw) {
  if (raw.accountType === undefined) return { status: 'absent' }
  return isValidLegacyRole(raw.accountType) ? { status: 'valid', role: raw.accountType } : { status: 'malformed' }
}
function evaluateRolesArray(raw) {
  if (raw.roles === undefined) return { status: 'absent' }
  const roles = raw.roles
  if (!Array.isArray(roles) || roles.length === 0) return { status: 'malformed' }
  if (!roles.every(isValidLegacyRole)) return { status: 'malformed' }
  const distinct = new Set(roles)
  return distinct.size === 1 ? { status: 'valid', role: [...distinct][0] } : { status: 'malformed' }
}
function normalizeUserProfile(raw) {
  if (isValidRole(raw.role)) {
    return { ...raw, role: raw.role }
  }
  const accountTypeResult = evaluateAccountType(raw)
  const rolesArrayResult = evaluateRolesArray(raw)
  if (accountTypeResult.status === 'malformed' || rolesArrayResult.status === 'malformed') {
    return { ...raw, role: 'owner' }
  }
  if (accountTypeResult.status === 'valid' && rolesArrayResult.status === 'valid') {
    return { ...raw, role: accountTypeResult.role === rolesArrayResult.role ? accountTypeResult.role : 'owner' }
  }
  const soleValid = accountTypeResult.status === 'valid' ? accountTypeResult
    : rolesArrayResult.status === 'valid' ? rolesArrayResult
    : null
  return { ...raw, role: soleValid?.role ?? 'owner' }
}

// ── Exact mirror of db.ts's updateUserProfile (real setDoc merge + role
// read-back verification against the emulator) ──
async function updateUserProfile(userId, data, { simulateNoop = false } = {}) {
  if (!simulateNoop) {
    await setDoc(doc(db, 'users', userId), { ...data, updatedAt: serverTimestamp() }, { merge: true })
  }
  if (data.role) {
    const confirm = await getDoc(doc(db, 'users', userId))
    if (confirm.data()?.role !== data.role) {
      throw new Error('ROLE_UPDATE_NOT_PERSISTED')
    }
  }
}

async function getUserProfile(userId) {
  const snap = await getDoc(doc(db, 'users', userId))
  if (!snap.exists()) return null
  return normalizeUserProfile({ ...snap.data(), uid: snap.id })
}

const R = Date.now()
async function newUser(name) {
  const email = `roletest.${name}.${R}@emulator.local`
  const password = 'tam12345*'
  const { user } = await createUserWithEmailAndPassword(auth, email, password)
  return { uid: user.uid, email, password }
}

// ── Test 1: Pet Owner persistence after refresh (fresh, independent read) ──
{
  const { uid } = await newUser('refresh')
  await setDoc(doc(db, 'users', uid), { role: 'breeder', kennelName: 'Test Kennel' })
  await updateUserProfile(uid, { role: 'owner' })
  const reread = await getUserProfile(uid) // simulates a page refresh's fresh getDoc
  check('Pet Owner persists after simulated refresh', reread.role === 'owner')
}

// ── Test 2: Breeder persistence after refresh (bidirectional) ──
{
  const { uid } = await newUser('refresh-back')
  await setDoc(doc(db, 'users', uid), { role: 'owner' })
  await updateUserProfile(uid, { role: 'breeder' })
  const reread = await getUserProfile(uid)
  check('Breeder persists after simulated refresh', reread.role === 'breeder')
}

// ── Test 3: Pet Owner persistence after re-login (independent app instance,
// simulating a fresh client session reconnecting rather than reusing any
// in-memory state) ──
{
  const { uid, email, password } = await newUser('relogin')
  await setDoc(doc(db, 'users', uid), { role: 'breeder' })
  await updateUserProfile(uid, { role: 'owner' })

  // Fresh app instance + fresh sign-in, not reusing any in-memory state from
  // the app instance that performed the switch above.
  const reloginApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, `relogin-${R}`)
  const reloginDb = getFirestore(reloginApp)
  connectFirestoreEmulator(reloginDb, '127.0.0.1', 8080)
  const reloginAuth = getAuth(reloginApp)
  connectAuthEmulator(reloginAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  await signInWithEmailAndPassword(reloginAuth, email, password)

  const freshSnap = await getDoc(doc(reloginDb, 'users', uid))
  const freshProfile = normalizeUserProfile({ ...freshSnap.data(), uid: freshSnap.id })
  check('Pet Owner persists across a fresh client session (re-login)', freshProfile.role === 'owner')
}

// ── Test 4: legacy accountType field normalizes to role ──
{
  const { uid } = await newUser('legacy-accounttype')
  await setDoc(doc(db, 'users', uid), { accountType: 'owner', kennelName: 'Legacy Kennel' })
  const profile = await getUserProfile(uid)
  check('Legacy accountType=owner normalizes to role=owner', profile.role === 'owner')
}

// ── Test 5: legacy roles[] array field (unambiguous — single distinct
// value) normalizes to role ──
{
  const { uid } = await newUser('legacy-roles-array')
  await setDoc(doc(db, 'users', uid), { roles: ['owner'] })
  const profile = await getUserProfile(uid)
  check('Legacy roles=["owner"] normalizes to role=owner', profile.role === 'owner')
}

// ── Test 6: invalid/garbage canonical role, no usable legacy signal, must
// fail safe to 'owner' (the non-privileged role) — never 'breeder' ──
{
  const { uid } = await newUser('invalid-role')
  await setDoc(doc(db, 'users', uid), { role: 'superuser' })
  const profile = await getUserProfile(uid)
  check('Invalid role value fails safe to owner, never breeder', profile.role === 'owner')
}

// ── Test 7: missing role field entirely fails safe to owner ──
{
  const { uid } = await newUser('no-role-field')
  await setDoc(doc(db, 'users', uid), { kennelName: 'No Role Set' })
  const profile = await getUserProfile(uid)
  check('Missing role field fails safe to owner', profile.role === 'owner')
}

// ── Test 6b: valid role='owner' is authoritative over a conflicting
// legacy breeder signal ──
{
  const { uid } = await newUser('valid-owner-overrides-legacy-breeder')
  await setDoc(doc(db, 'users', uid), { role: 'owner', accountType: 'breeder', roles: ['breeder'] })
  const profile = await getUserProfile(uid)
  check("Valid role='owner' overrides conflicting legacy breeder fields", profile.role === 'owner')
}

// ── Test 6c: valid role='breeder' remains breeder regardless of legacy ──
{
  const { uid } = await newUser('valid-breeder-stays-breeder')
  await setDoc(doc(db, 'users', uid), { role: 'breeder', accountType: 'owner' })
  const profile = await getUserProfile(uid)
  check("Valid role='breeder' remains breeder", profile.role === 'breeder')
}

// ── Test 6d: invalid canonical + unambiguous owner legacy → owner ──
{
  const { uid } = await newUser('invalid-canonical-unambiguous-owner-legacy')
  await setDoc(doc(db, 'users', uid), { role: 'superuser', accountType: 'owner' })
  const profile = await getUserProfile(uid)
  check('Invalid canonical + unambiguous owner legacy resolves to owner', profile.role === 'owner')
}

// ── Test 6e: invalid canonical + unambiguous breeder legacy → breeder.
// Deliberately permitted: this is the actual motivating case for legacy
// fallback existing at all — a genuinely pre-existing breeder account
// hand-edited before the `role` field existed must still resolve
// correctly, not be demoted just because it predates the convention. The
// safety requirement is about MALFORMED/CONFLICTING data, not about
// honoring a single, clear, unambiguous legacy signal. ──
{
  const { uid } = await newUser('invalid-canonical-unambiguous-breeder-legacy')
  await setDoc(doc(db, 'users', uid), { role: 'superuser', accountType: 'breeder' })
  const profile = await getUserProfile(uid)
  check('Invalid canonical + unambiguous breeder legacy resolves to breeder (permitted by policy)', profile.role === 'breeder')
}

// ── Test 6f: invalid canonical + CONFLICTING legacy (accountType vs
// roles[] disagree) → safest non-privileged fallback, never breeder ──
{
  const { uid } = await newUser('invalid-canonical-conflicting-legacy')
  await setDoc(doc(db, 'users', uid), { role: 'superuser', accountType: 'breeder', roles: ['owner'] })
  const profile = await getUserProfile(uid)
  check('Invalid canonical + conflicting legacy fields fails safe to owner', profile.role === 'owner')
}

// ── Test 6g: conflicting legacy fields alone (no canonical role field at
// all) → safest non-privileged fallback ──
{
  const { uid } = await newUser('conflicting-legacy-no-canonical')
  await setDoc(doc(db, 'users', uid), { accountType: 'owner', roles: ['breeder'] })
  const profile = await getUserProfile(uid)
  check('Conflicting legacy fields (no canonical) fails safe to owner', profile.role === 'owner')
}

// ── Test 6h: malformed field types (wrong JS type, not just wrong string) ──
{
  const { uid } = await newUser('malformed-types')
  await setDoc(doc(db, 'users', uid), { role: 123, accountType: {}, roles: 'owner' })
  const profile = await getUserProfile(uid)
  check('Malformed role/accountType/roles types all fail safe to owner', profile.role === 'owner')
}

// ── Test 6i: role explicitly null falls through to legacy, same as
// missing entirely ──
{
  const { uid } = await newUser('null-role-falls-through')
  await setDoc(doc(db, 'users', uid), { role: null, accountType: 'owner' })
  const profile = await getUserProfile(uid)
  check('role: null falls through to legacy accountType', profile.role === 'owner')
}

// ── Test 6j: empty roles array is not a usable signal ──
{
  const { uid } = await newUser('empty-roles-array')
  await setDoc(doc(db, 'users', uid), { roles: [] })
  const profile = await getUserProfile(uid)
  check('Empty roles[] array fails safe to owner', profile.role === 'owner')
}

// ── Test 6k: duplicate identical values in roles[] are unambiguous ──
{
  const { uid } = await newUser('duplicate-roles')
  await setDoc(doc(db, 'users', uid), { roles: ['breeder', 'breeder'] })
  const profile = await getUserProfile(uid)
  check('Duplicate identical roles[] values resolve unambiguously', profile.role === 'breeder')
}

// ── Test 6l: roles[] containing genuinely different values is ambiguous,
// even with no accountType present at all ──
{
  const { uid } = await newUser('roles-array-internally-conflicting')
  await setDoc(doc(db, 'users', uid), { roles: ['owner', 'breeder'] })
  const profile = await getUserProfile(uid)
  check('roles[] with two distinct values is ambiguous, fails safe to owner', profile.role === 'owner')
}

// ── Mixed legacy roles[] array remediation: an array containing even one
// malformed/invalid element must never resolve to breeder or any
// privileged role — the bug was that invalid entries were silently
// filtered out before checking ambiguity, so ['breeder', 123] resolved to
// 'breeder' (the garbage entry was dropped, leaving an "unambiguous"
// breeder). Every one of these must fail safe to 'owner'. ──
{
  const cases = [
    ['breeder', 'unknown'],
    ['owner', 'unknown'],
    ['breeder', 123],
    ['owner', null],
    ['breeder', {}],
  ]
  for (const roles of cases) {
    const { uid } = await newUser(`mixed-array-${JSON.stringify(roles)}`.replace(/[^a-z0-9]/gi, '_'))
    await setDoc(doc(db, 'users', uid), { roles })
    const profile = await getUserProfile(uid)
    check(`roles=${JSON.stringify(roles)} (mixed valid+invalid) fails safe to owner`, profile.role === 'owner')
  }
}

// ── Mixed-array remediation: unambiguous all-valid arrays still resolve
// correctly (these already passed before the fix — confirming no
// regression from the stricter "every element must be valid" check) ──
{
  const { uid: uidA } = await newUser('all-valid-breeder-dup')
  await setDoc(doc(db, 'users', uidA), { roles: ['breeder', 'breeder'] })
  check("roles=['breeder','breeder'] resolves to breeder", (await getUserProfile(uidA)).role === 'breeder')

  const { uid: uidB } = await newUser('all-valid-owner-dup')
  await setDoc(doc(db, 'users', uidB), { roles: ['owner', 'owner'] })
  check("roles=['owner','owner'] resolves to owner", (await getUserProfile(uidB)).role === 'owner')

  const { uid: uidC } = await newUser('all-valid-conflicting')
  await setDoc(doc(db, 'users', uidC), { roles: ['owner', 'breeder'] })
  check("roles=['owner','breeder'] (all valid, but conflicting) fails safe to owner", (await getUserProfile(uidC)).role === 'owner')
}

// ── Mixed-array remediation: empty array and non-array roles value ──
{
  const { uid: uidA } = await newUser('mixed-remediation-empty-array')
  await setDoc(doc(db, 'users', uidA), { roles: [] })
  check('Empty roles[] array fails safe to owner (remediation re-check)', (await getUserProfile(uidA)).role === 'owner')

  const { uid: uidB } = await newUser('mixed-remediation-non-array')
  await setDoc(doc(db, 'users', uidB), { roles: 'owner' })
  check('Non-array roles value fails safe to owner', (await getUserProfile(uidB)).role === 'owner')
}

// ── Mixed-array remediation: a valid canonical role overrides a malformed
// legacy array entirely, in both directions ──
{
  const { uid: uidA } = await newUser('valid-canonical-breeder-overrides-malformed-array')
  await setDoc(doc(db, 'users', uidA), { role: 'breeder', roles: ['owner', 123] })
  check('Valid canonical breeder overrides a malformed legacy roles[] array', (await getUserProfile(uidA)).role === 'breeder')

  const { uid: uidB } = await newUser('valid-canonical-owner-overrides-malformed-array')
  await setDoc(doc(db, 'users', uidB), { role: 'owner', roles: ['breeder', 'unknown'] })
  check('Valid canonical owner overrides a malformed legacy roles[] array', (await getUserProfile(uidB)).role === 'owner')
}

// ── Cross-field remediation: invalid canonical + malformed roles[] +
// otherwise-clean accountType. SUPERSEDES the prior policy — a present-
// but-malformed legacy source now voids the ENTIRE legacy fallback, not
// just its own contribution, even when the sibling field looks perfectly
// clean. A malformed field is exactly the kind of corrupted/tampered data
// this fallback must be defensive against; its mere presence casts doubt
// on the whole legacy signal. ──
{
  const { uid } = await newUser('invalid-canonical-malformed-array-valid-accounttype')
  await setDoc(doc(db, 'users', uid), { role: 'superuser', roles: ['breeder', 123], accountType: 'breeder' })
  const profile = await getUserProfile(uid)
  check('Present-but-malformed roles[] voids the whole legacy fallback, even with a clean accountType', profile.role === 'owner')
}

// ── Exhaustive table-driven cross-field coverage (canonical always
// missing/invalid in every row here, so only legacy resolution is under
// test) — every combination of absent/valid/malformed accountType x
// absent/valid/malformed roles[] from the final policy's decision matrix. ──
{
  const table = [
    { accountType: undefined, roles: undefined, expected: 'owner', desc: 'both absent' },
    { accountType: 'breeder', roles: undefined, expected: 'breeder', desc: 'accountType breeder, roles absent' },
    { accountType: 'owner', roles: undefined, expected: 'owner', desc: 'accountType owner, roles absent' },
    { accountType: undefined, roles: ['breeder'], expected: 'breeder', desc: 'accountType absent, roles breeder' },
    { accountType: undefined, roles: ['owner'], expected: 'owner', desc: 'accountType absent, roles owner' },
    { accountType: 'breeder', roles: ['breeder'], expected: 'breeder', desc: 'both breeder agree' },
    { accountType: 'owner', roles: ['owner'], expected: 'owner', desc: 'both owner agree' },
    { accountType: 'breeder', roles: ['owner'], expected: 'owner', desc: 'breeder vs owner disagree' },
    { accountType: 'owner', roles: ['breeder'], expected: 'owner', desc: 'owner vs breeder disagree' },
    { accountType: 123, roles: ['breeder'], expected: 'owner', desc: 'accountType malformed(123), roles clean breeder' },
    { accountType: {}, roles: ['owner'], expected: 'owner', desc: 'accountType malformed({}), roles clean owner' },
    { accountType: 'breeder', roles: ['breeder', 'unknown'], expected: 'owner', desc: 'accountType clean breeder, roles malformed mixed' },
    { accountType: 'breeder', roles: null, expected: 'owner', desc: 'accountType clean breeder, roles=null present' },
    { accountType: 'owner', roles: [], expected: 'owner', desc: 'accountType clean owner, roles=[] present empty' },
    { accountType: 'owner', roles: 'owner', expected: 'owner', desc: 'accountType clean owner, roles non-array present' },
    { accountType: 123, roles: null, expected: 'owner', desc: 'both malformed' },
    { accountType: undefined, roles: ['breeder', 'unknown'], expected: 'owner', desc: 'accountType absent, roles malformed' },
    { accountType: undefined, roles: null, expected: 'owner', desc: 'accountType absent, roles=null present malformed' },
    { accountType: 123, roles: undefined, expected: 'owner', desc: 'accountType malformed, roles absent' },
    { accountType: 'garbage', roles: undefined, expected: 'owner', desc: 'accountType malformed string, roles absent' },
  ]
  for (const [i, { accountType, roles, expected, desc }] of table.entries()) {
    const data = {}
    if (accountType !== undefined) data.accountType = accountType
    if (roles !== undefined) data.roles = roles
    const { uid } = await newUser(`table${i}`)
    await setDoc(doc(db, 'users', uid), data)
    const profile = await getUserProfile(uid)
    check(`[cross-field table] ${desc} -> ${expected}`, profile.role === expected, `got ${profile.role}`)
  }
}

// ── A valid canonical role remains authoritative no matter how malformed
// the legacy fields are, including 'admin' (which legacy can never grant
// on its own) ──
{
  const { uid: uidA } = await newUser('canonical-admin-overrides-malformed-legacy')
  await setDoc(doc(db, 'users', uidA), { role: 'admin', accountType: 123, roles: null })
  check("Valid canonical 'admin' is authoritative over malformed legacy fields", (await getUserProfile(uidA)).role === 'admin')

  const { uid: uidB } = await newUser('legacy-cannot-ever-grant-admin')
  await setDoc(doc(db, 'users', uidB), { accountType: 'admin', roles: ['admin'] })
  const profileB = await getUserProfile(uidB)
  check("Legacy 'admin' values are not recognized as valid legacy roles at all, fails safe to owner", profileB.role === 'owner')
}

// ── Mixed-array remediation: malformed legacy array can never expose
// breeder-gated navigation/settings (end-to-end isOwner check) ──
{
  const { uid } = await newUser('malformed-array-cannot-expose-breeder-ui')
  await setDoc(doc(db, 'users', uid), { roles: ['breeder', {}] })
  const profile = await getUserProfile(uid)
  check('Malformed roles[] array cannot expose breeder-gated UI (isOwner stays true)', (profile?.role === 'owner'))
}

// ── Test 6m: malformed data can never produce breeder-gated UI access —
// end-to-end check that isOwner (the exact predicate every page/component
// uses) evaluates true for a malformed/conflicting profile ──
{
  const { uid } = await newUser('cannot-gain-breeder-via-malformed-data')
  await setDoc(doc(db, 'users', uid), { role: 'not-a-real-role', accountType: 'breeder', roles: ['owner'] })
  const profile = await getUserProfile(uid)
  const isOwner = profile?.role === 'owner'
  check('Malformed + conflicting profile cannot gain breeder-gated UI access (isOwner stays true)', isOwner === true)
}

// ── Test 8: role write does not lose unrelated existing fields ──
{
  const { uid } = await newUser('unrelated-fields')
  await setDoc(doc(db, 'users', uid), {
    role: 'breeder', kennelName: 'Keep Me Kennel', firstName: 'Keep', lastName: 'Me',
    breederIdValue: 'DACO99999', phone: '0400000000',
  })
  await updateUserProfile(uid, { role: 'owner' })
  const profile = await getUserProfile(uid)
  check('Role switch does not delete kennelName', profile.kennelName === 'Keep Me Kennel')
  check('Role switch does not delete firstName/lastName', profile.firstName === 'Keep' && profile.lastName === 'Me')
  check('Role switch does not delete breederIdValue', profile.breederIdValue === 'DACO99999')
  check('Role switch does not delete phone', profile.phone === '0400000000')
}

// ── Test 9: a genuine no-op write (simulated) is caught as an error rather
// than reported as a false success ──
{
  const { uid } = await newUser('silent-noop')
  await setDoc(doc(db, 'users', uid), { role: 'breeder' })
  let threw = false
  try {
    await updateUserProfile(uid, { role: 'owner' }, { simulateNoop: true })
  } catch (err) {
    threw = err.message === 'ROLE_UPDATE_NOT_PERSISTED'
  }
  check('A role update that does not persist throws instead of silently succeeding', threw)
}

// ── Test 10: no PII logging in the changed db.ts functions ──
{
  const src = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const normalizeSection = src.slice(src.indexOf('function normalizeUserProfile'), src.indexOf('export async function getUserProfile'))
  const updateSection = src.slice(src.indexOf('export async function updateUserProfile'), src.indexOf('export async function updateUserProfile') + 800)
  check('normalizeUserProfile has no console.log', !normalizeSection.includes('console.log'))
  check('updateUserProfile has no console.log referencing user data', !updateSection.includes('console.log'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
