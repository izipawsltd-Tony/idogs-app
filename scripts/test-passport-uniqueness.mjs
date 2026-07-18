// ADR-002 Phase C1 — emulator regression test for passportId uniqueness
// (reservePassportId() in src/lib/db.ts). Mirrors the exact transaction
// logic against the real Firestore emulator client SDK (same pattern as
// this project's other emulator test scripts — db.ts is a Vite module
// that reads import.meta.env, so it can't be imported directly into a
// plain Node script; the Firestore transaction semantics being tested
// are identical either way).
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-passport-uniqueness.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, runTransaction, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

const PW = 'tam12345*'
const R = Date.now()
const email = n => `passportuniq.${n}.${R}@emulator.local`
async function newUser(name) { const { user } = await createUserWithEmailAndPassword(auth, email(name), PW); return user.uid }

// Exact mirror of src/lib/db.ts's reservePassportId(), with the
// candidate-generator injected so collision scenarios are deterministic
// to test (real production code draws candidates from nanoid()).
const MAX_PASSPORT_ID_ATTEMPTS = 5
async function reservePassportId(generateCandidate, uid) {
  for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
    const candidate = generateCandidate(attempt)
    const reservationRef = doc(db, 'passportReservations', candidate)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef)
        if (snap.exists()) throw new Error('PASSPORT_ID_TAKEN')
        tx.set(reservationRef, { createdAt: new Date().toISOString(), createdBy: uid })
      })
      return candidate
    } catch (err) {
      if (err?.message !== 'PASSPORT_ID_TAKEN') throw err
    }
  }
  throw new Error('Could not generate a unique passport ID — please try again')
}

const uid1 = await newUser('user1')

// ── Test 1: unique ID accepted on first try ──
{
  const candidateId = `UNQ-2026-${R}A`
  let result, threw = false
  try { result = await reservePassportId(() => candidateId, uid1) } catch { threw = true }
  check('Unique candidate is accepted on first attempt', !threw && result === candidateId)

  const reservationSnap = await getDoc(doc(db, 'passportReservations', candidateId))
  check('Reservation document exists after success', reservationSnap.exists())
}

// ── Test 2: collision causes regeneration ──
{
  const takenId = `COL-2026-${R}B`
  const freshId = `COL-2026-${R}C`
  // Pre-seed a reservation to simulate an existing collision. createdBy
  // must match the signed-in user (rule requirement) — the collision
  // check only cares that the document exists, not who created it.
  await setDoc(doc(db, 'passportReservations', takenId), { createdAt: new Date().toISOString(), createdBy: uid1 })

  let calls = 0
  const generateCandidate = () => { calls++; return calls === 1 ? takenId : freshId }

  let result, threw = false
  try { result = await reservePassportId(generateCandidate, uid1) } catch { threw = true }
  check('On collision, a second (fresh) candidate is generated and accepted', !threw && result === freshId, `got ${result}, calls=${calls}`)
  check('Generator was called exactly twice (1 collision + 1 success)', calls === 2, `calls=${calls}`)

  const freshReservation = await getDoc(doc(db, 'passportReservations', freshId))
  check('The fresh candidate\'s reservation now exists', freshReservation.exists())
  // The taken one must be untouched — never overwritten.
  const takenReservation = await getDoc(doc(db, 'passportReservations', takenId))
  check('The original (colliding) reservation is unchanged, never overwritten', takenReservation.data()?.createdBy === uid1)
}

// ── Test 3: bounded retry failure handled safely ──
{
  const alwaysTakenId = `MAX-2026-${R}D`
  await setDoc(doc(db, 'passportReservations', alwaysTakenId), { createdAt: new Date().toISOString(), createdBy: uid1 })

  let calls = 0
  const generateCandidate = () => { calls++; return alwaysTakenId } // always collides

  let threw = false, errorMessage = ''
  try {
    await reservePassportId(generateCandidate, uid1)
  } catch (err) {
    threw = true
    errorMessage = err.message
  }
  check('Exhausting all attempts throws rather than silently reusing an ID', threw)
  check('Attempts are bounded at MAX_PASSPORT_ID_ATTEMPTS', calls === MAX_PASSPORT_ID_ATTEMPTS, `calls=${calls}`)
  check('Failure message is safe/generic, not an internal stack trace', errorMessage.includes('unique passport ID'), errorMessage)
}

// ── Test 4: unrelated user cannot overwrite an existing reservation ──
{
  // Pre-seed while still signed in as uid1 (rule requires createdBy to
  // match the signer), then switch to a second user to attempt the
  // overwrite/collision.
  const someoneElsesId = `SEC-2026-${R}E`
  await setDoc(doc(db, 'passportReservations', someoneElsesId), { createdAt: new Date().toISOString(), createdBy: uid1 })

  await signOut(auth)
  const uid2 = await newUser('user2')

  let denied = false
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, 'passportReservations', someoneElsesId))
      if (snap.exists()) throw new Error('PASSPORT_ID_TAKEN') // same guard as production logic
      tx.set(doc(db, 'passportReservations', someoneElsesId), { createdAt: new Date().toISOString(), createdBy: uid2 })
    })
  } catch (err) {
    denied = err.message === 'PASSPORT_ID_TAKEN'
  }
  check('A second user cannot claim an already-reserved passportId', denied)

  // Also confirm the rules themselves deny a raw overwrite attempt (not just app-level logic)
  let ruleDenied = false
  try {
    await setDoc(doc(db, 'passportReservations', someoneElsesId), { createdAt: new Date().toISOString(), createdBy: uid2 })
  } catch (err) {
    ruleDenied = err.code === 'permission-denied' || /permission/i.test(err.message)
  }
  check('firestore.rules itself denies overwriting an existing reservation (update forbidden)', ruleDenied)
}

summary()
