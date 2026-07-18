// Emulator-only regression test for the reminders/{id} firestore.rules.
//
// Covers the scenario that motivated splitting `read` into separate
// `get`/`list` rules: upsertVaccineReminder()'s dedupe check calls getDoc()
// on a reminder that may not exist yet. Under a combined `read` rule,
// dereferencing resource.data on a get() for a missing document throws
// permission-denied (evaluation error => deny), silently breaking the
// dedupe check on every vaccine's first-ever reminder.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-reminder-rules.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, setDoc, deleteDoc } from 'firebase/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

const PW = 'tam12345*'
const runId = Date.now() // unique per run so re-invocations don't collide with prior emulator state
const { user: breeder } = await createUserWithEmailAndPassword(auth, `full.breeder.${runId}@emulator.local`, PW)
const breederUid = breeder.uid

// Dedupe existence check on a not-yet-created reminder
const rid1 = `vaccine_dogA_v1_${runId}`
try {
  const snap = await getDoc(doc(db, 'reminders', rid1))
  check('dedupe get() on non-existent reminder does not throw', true)
  check('  exists() is false', snap.exists() === false)
} catch (err) {
  check('dedupe get() on non-existent reminder does not throw', false, err.code)
}

// create
try {
  await setDoc(doc(db, 'reminders', rid1), {
    id: rid1, dogId: 'dogA', tenantId: breederUid, title: 't', dueDate: '2026-01-01',
    type: 'vaccine', status: 'pending', createdAt: new Date().toISOString(),
  })
  check('tenant create reminder succeeds', true)
} catch (err) { check('tenant create reminder succeeds', false, err.code) }

// tenant get (existing)
try {
  const snap = await getDoc(doc(db, 'reminders', rid1))
  check('tenant get() on own existing reminder succeeds', snap.exists())
} catch (err) { check('tenant get() on own existing reminder succeeds', false, err.code) }

// tenant list (query)
try {
  const snap = await getDocs(query(collection(db, 'reminders'), where('tenantId', '==', breederUid)))
  check('tenant list() query succeeds', snap.size >= 1)
} catch (err) { check('tenant list() query succeeds', false, err.code) }

// tenant update
try {
  await setDoc(doc(db, 'reminders', rid1), { status: 'overdue' }, { merge: true })
  check('tenant update reminder succeeds', true)
} catch (err) { check('tenant update reminder succeeds', false, err.code) }

// --- claimed-dog current-owner scenario ---
// Simulate: dog transferred, reminder doc still tagged with the ORIGINAL
// breeder's tenantId. The new owner's own tenantId-scoped queries/dedupe
// checks must keep working; only direct access to the old doc is denied
// (expected — getReminders()'s dogId-only fallback query is wrapped in a
// try/catch for exactly this case, see src/lib/db.ts).
await signOut(auth)
const { user: newOwner } = await createUserWithEmailAndPassword(auth, `full.newowner.${runId}@emulator.local`, PW)
const newOwnerUid = newOwner.uid

try {
  const snap = await getDocs(query(collection(db, 'reminders'), where('tenantId', '==', newOwnerUid)))
  check('new owner tenantId-scoped list (no match) returns empty, no throw', snap.size === 0)
} catch (err) { check('new owner tenantId-scoped list (no match) returns empty, no throw', false, err.code) }

try {
  await getDoc(doc(db, 'reminders', `vaccine_dogA_newowner_v1_${runId}`))
  check('new owner get() on their own non-existent reminder id does not throw', true)
} catch (err) { check('new owner get() on their own non-existent reminder id does not throw', false, err.code) }

let deniedOldDoc = false
try {
  await getDoc(doc(db, 'reminders', rid1))
} catch (err) { deniedOldDoc = err.code === 'permission-denied' || /permission/i.test(err.message) }
check('new owner get() on old breeder-tenanted reminder doc is denied (expected)', deniedOldDoc)

// --- unrelated user denial (tenant isolation) ---
await signOut(auth)
await createUserWithEmailAndPassword(auth, `full.stranger.${runId}@emulator.local`, PW)

let strangerDenied = false
try {
  await getDoc(doc(db, 'reminders', rid1))
} catch (err) { strangerDenied = err.code === 'permission-denied' || /permission/i.test(err.message) }
check('unrelated user get() on someone else\'s reminder is denied', strangerDenied)

try {
  const snap = await getDocs(query(collection(db, 'reminders'), where('tenantId', '==', breederUid)))
  check('unrelated user cannot list() another tenant\'s reminders', false, `got ${snap.size} docs - SECURITY ISSUE if >0`)
} catch (err) {
  check('unrelated user cannot list() another tenant\'s reminders', err.code === 'permission-denied' || /permission/i.test(err.message))
}

let strangerUpdateDenied = false
try {
  await setDoc(doc(db, 'reminders', rid1), { status: 'hacked' }, { merge: true })
} catch (err) { strangerUpdateDenied = err.code === 'permission-denied' || /permission/i.test(err.message) }
check('unrelated user update on someone else\'s reminder is denied', strangerUpdateDenied)

let strangerDeleteDenied = false
try {
  await deleteDoc(doc(db, 'reminders', rid1))
} catch (err) { strangerDeleteDenied = err.code === 'permission-denied' || /permission/i.test(err.message) }
check('unrelated user delete on someone else\'s reminder is denied', strangerDeleteDenied)

// --- delete as actual owner ---
await signOut(auth)
await signInWithEmailAndPassword(auth, `full.breeder.${runId}@emulator.local`, PW)
try {
  await deleteDoc(doc(db, 'reminders', rid1))
  check('tenant can delete their own reminder', true)
} catch (err) { check('tenant can delete their own reminder', false, err.code) }

await summary()
