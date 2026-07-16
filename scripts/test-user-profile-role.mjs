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

// ── Exact mirror of db.ts's normalizeUserProfile ──
function normalizeUserProfile(raw) {
  const legacyRole = raw.role ?? raw.accountType ?? (Array.isArray(raw.roles) ? raw.roles[0] : undefined)
  const role = (legacyRole === 'owner' || legacyRole === 'admin') ? legacyRole : 'breeder'
  return { ...raw, role }
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

// ── Test 5: legacy roles[] array field normalizes to role ──
{
  const { uid } = await newUser('legacy-roles-array')
  await setDoc(doc(db, 'users', uid), { roles: ['owner', 'breeder'] })
  const profile = await getUserProfile(uid)
  check('Legacy roles=["owner",...] normalizes to role=owner', profile.role === 'owner')
}

// ── Test 6: invalid/garbage role value defaults safely to breeder ──
{
  const { uid } = await newUser('invalid-role')
  await setDoc(doc(db, 'users', uid), { role: 'superuser' })
  const profile = await getUserProfile(uid)
  check('Invalid role value defaults to breeder, not left as garbage', profile.role === 'breeder')
}

// ── Test 7: missing role field entirely defaults to breeder ──
{
  const { uid } = await newUser('no-role-field')
  await setDoc(doc(db, 'users', uid), { kennelName: 'No Role Set' })
  const profile = await getUserProfile(uid)
  check('Missing role field defaults to breeder', profile.role === 'breeder')
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
