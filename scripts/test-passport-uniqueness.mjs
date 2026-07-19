// Codex round 17, Blocker 1 — emulator regression tests for createDog()'s
// atomic Passport-reservation + Dog-creation transaction in src/lib/db.ts.
//
// Round 17 replaced the old two-step flow (a standalone reservePassportId()
// transaction, immediately followed by a separate, non-transactional
// addDoc() for the Dog) with ONE runTransaction() call that stages both the
// passportReservations/{candidate} write and the dogs/{dogId} write
// together — either both commit or neither does. This file replaces the
// previous version, which only exercised the now-deleted standalone
// reservePassportId() shape.
//
// Mirrors the exact transaction body from src/lib/db.ts's createDog()
// against the real Firestore emulator client SDK (db.ts itself can't be
// imported into a plain Node script — it pulls in ./firebase.ts, which
// reads import.meta.env, a Vite-only global). A source-pattern check
// against the real file (below) guards against the mirror silently
// drifting from production behaviour.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. node scripts/test-passport-uniqueness.mjs

import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, collection, runTransaction, getDoc, setDoc } from 'firebase/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

const PW = 'tam12345*'
const R = Date.now()
const email = n => `atomiccreate.${n}.${R}@emulator.local`
async function newUser(name) { const { user } = await createUserWithEmailAndPassword(auth, email(name), PW); return user.uid }

// ── Source-pattern drift guard ──
// Asserts the real db.ts still has the structural shape these tests rely
// on: dogRef generated before the retry loop, both writes staged inside
// ONE runTransaction() callback, reservation bound to dogRef.id, and no
// separate addDoc()/reservePassportId() call remaining.
{
  // db.ts uses CRLF line endings — \r?\n throughout, not a bare \n.
  const src = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const createDogMatch = src.match(/export async function createDog\([\s\S]*?\r?\n}\r?\n/)
  check('db.ts still exports createDog()', !!createDogMatch)
  const body = createDogMatch ? createDogMatch[0] : ''
  check('createDog() generates dogRef before the retry loop', /const dogRef = doc\(collection\(db, 'dogs'\)\)/.test(body))
  check('createDog() stages the reservation write inside runTransaction', /tx\.set\(reservationRef,/.test(body))
  check('createDog() stages the Dog write inside the SAME runTransaction callback', /tx\.set\(dogRef,/.test(body))
  check('reservation is bound to dogRef.id', /dogId: dogRef\.id/.test(body))
  check('no separate addDoc() call remains (single-transaction only)', !/addDoc\(/.test(body))
  check('no standalone reservePassportId() function remains in db.ts', !/function reservePassportId/.test(src))
}

// Exact mirror of src/lib/db.ts's createDog() transaction body. candidate
// generation is injected so collision/concurrency scenarios are
// deterministic to test (production draws candidates from nanoid()).
const MAX_PASSPORT_ID_ATTEMPTS = 5
async function createDogAtomic({ creatorUid, dateOfBirth, sourceType = 'BREEDER_ISSUED', generateCandidate, dogRef: dogRefOverride }) {
  const dogRef = dogRefOverride || doc(collection(db, 'dogs'))
  let attempts = 0
  for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
    attempts++
    const candidate = generateCandidate(attempt)
    const reservationRef = doc(db, 'passportReservations', candidate)
    try {
      await runTransaction(db, async (tx) => {
        const reservationSnap = await tx.get(reservationRef)
        if (reservationSnap.exists()) throw new Error('PASSPORT_ID_TAKEN')
        tx.set(reservationRef, { createdAt: new Date().toISOString(), createdBy: creatorUid, dogId: dogRef.id })
        tx.set(dogRef, {
          name: 'Test',
          dateOfBirth,
          breed: 'Labrador',
          tenantId: creatorUid,
          currentOwnerId: creatorUid,
          createdByUserId: creatorUid,
          sourceType,
          ...(sourceType === 'BREEDER_ISSUED' ? { originBreederId: creatorUid } : {}),
          passportId: candidate,
          lifeStage: 'puppy',
          isDeceased: false,
          photos: [],
          notes: '',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      })
      return { dogId: dogRef.id, passportId: candidate, attempts }
    } catch (err) {
      if (err?.message !== 'PASSPORT_ID_TAKEN') throw err
    }
  }
  throw new Error('Could not generate a unique passport ID — please try again')
}

const uid1 = await newUser('user1')

// ── Test 1: success — both writes commit together, bound to the same dogId ──
{
  const candidateId = `SUC-2026-${R}A`
  let result, threw = false
  try {
    result = await createDogAtomic({ creatorUid: uid1, dateOfBirth: '2024-01-01', generateCandidate: () => candidateId })
  } catch { threw = true }
  check('Atomic create succeeds on first attempt with a unique candidate', !threw)

  const dogSnap = result ? await getDoc(doc(db, 'dogs', result.dogId)) : null
  check('Dog document exists after success', !!dogSnap?.exists())
  check('Dog document carries the reserved passportId', dogSnap?.data()?.passportId === candidateId)
  check('Dog document is attributed to the correct creator (tenantId/currentOwnerId/createdByUserId)',
    dogSnap?.data()?.tenantId === uid1 && dogSnap?.data()?.currentOwnerId === uid1 && dogSnap?.data()?.createdByUserId === uid1)

  const reservationSnap = await getDoc(doc(db, 'passportReservations', candidateId))
  check('Reservation document exists after success', reservationSnap.exists())
  check('Reservation is bound to the exact dogId it was created for', reservationSnap.data()?.dogId === result?.dogId)
}

// ── Test 2: Dog-write failure leaves no orphan reservation ──
// An invalid dateOfBirth makes firestore.rules deny the Dog write
// (isValidDobString) — since both writes are staged in the SAME
// transaction, the whole commit is rejected, so the reservation must
// never survive either, even though its own write in isolation would have
// been perfectly valid.
{
  const candidateId = `WFL-2026-${R}B`
  // Pre-generate the dogRef so its non-existence can be checked with a
  // direct getDoc() afterward — firestore.rules' dogs `list` rule can
  // only be satisfied by a query itself constrained on tenantId/
  // currentOwnerId (see the round-17 note on Test 3/5 below), so a plain
  // where('passportId', ...) list query is rules-denied for a signed-in
  // user regardless of whether any matching doc exists. A direct getDoc()
  // by known id sidesteps that entirely and is the more precise check
  // anyway (proves THIS specific dogRef was never written, not just that
  // no doc anywhere happens to carry this passportId).
  const dogRef = doc(collection(db, 'dogs'))
  let threw = false, errMsg = ''
  try {
    await createDogAtomic({ creatorUid: uid1, dateOfBirth: 'not-a-date', generateCandidate: () => candidateId, dogRef })
  } catch (err) {
    threw = true
    errMsg = err?.message || String(err)
  }
  check('Create throws when the Dog write is rules-denied (malformed dateOfBirth)', threw, errMsg)

  const reservationSnap = await getDoc(doc(db, 'passportReservations', candidateId))
  check('No orphan reservation survives a Dog-write failure — the whole transaction rolled back', !reservationSnap.exists())
  const dogSnap = await getDoc(dogRef)
  check('No orphan Dog document survives a Dog-write failure', !dogSnap.exists())
}

// ── Test 3: reservation conflict triggers retry with dogRef reused, not regenerated ──
{
  const takenId = `COL-2026-${R}C`
  const freshId = `COL-2026-${R}D`
  await setDoc(doc(db, 'passportReservations', takenId), { createdAt: new Date().toISOString(), createdBy: uid1, dogId: 'someone-elses-dog' })

  const dogRef = doc(collection(db, 'dogs'))
  let calls = 0
  const generateCandidate = () => { calls++; return calls === 1 ? takenId : freshId }

  let result, threw = false
  try {
    result = await createDogAtomic({ creatorUid: uid1, dateOfBirth: '2024-01-01', generateCandidate, dogRef })
  } catch { threw = true }
  check('On reservation conflict, retry with a fresh candidate succeeds', !threw && result?.passportId === freshId, `got ${result?.passportId}`)
  check('Exactly one retry occurred (1 collision + 1 success)', calls === 2, `calls=${calls}`)
  check('The SAME dogRef.id is reused across the retry — never regenerated', result?.dogId === dogRef.id)

  const dogSnap = await getDoc(dogRef)
  check('The Dog document was created exactly once, using the fresh passportId', dogSnap.data()?.passportId === freshId)
  const takenReservation = await getDoc(doc(db, 'passportReservations', takenId))
  check('The original (colliding) reservation is unchanged — still points at the OTHER dog', takenReservation.data()?.dogId === 'someone-elses-dog')
}

// ── Test 4: auth mismatch — a captured creatorUid that no longer matches
// the signed-in session cannot slip a write through ──
// Mirrors createDog() capturing creatorUid ONCE, before any await; if the
// session's actual auth.uid has since changed (e.g. logout/switch mid-
// call), firestore.rules requires tenantId/currentOwnerId/createdByUserId
// to equal request.auth.uid — the CURRENT session — so a stale captured
// uid is rejected outright, and (being the same transaction) leaves no
// orphan reservation either.
{
  await signOut(auth)
  const uid2 = await newUser('user2')
  // uid2 is now signed in, but we simulate a creatorUid captured from a
  // PRIOR (now stale) session — uid1 — being used for the write.
  const candidateId = `AUM-2026-${R}E`
  const dogRef = doc(collection(db, 'dogs'))
  let threw = false, code = ''
  try {
    await createDogAtomic({ creatorUid: uid1, dateOfBirth: '2024-01-01', generateCandidate: () => candidateId, dogRef })
  } catch (err) {
    threw = true
    code = err?.code || err?.message || String(err)
  }
  check('A stale/mismatched creatorUid is rejected by firestore.rules, not silently written', threw, code)

  const reservationSnap = await getDoc(doc(db, 'passportReservations', candidateId))
  check('No orphan reservation survives an auth-mismatch rejection', !reservationSnap.exists())
  const dogSnap = await getDoc(dogRef)
  check('No orphan Dog document survives an auth-mismatch rejection', !dogSnap.exists())
}

// ── Test 5: concurrent attempts on the SAME candidate — only one wins ──
{
  const uid2 = auth.currentUser?.uid
  check('A second user session is active for the concurrency test', !!uid2)

  const contested = `CNC-2026-${R}F`
  // Both "callers" race for the exact same candidate on their first
  // attempt; each falls back to its own unique candidate on retry so we
  // can tell them apart afterward without depending on which one the
  // Firestore emulator happens to let win.
  const fallbackA = `CNC-2026-${R}FA`
  const fallbackB = `CNC-2026-${R}FB`
  let callsA = 0, callsB = 0
  const genA = () => { callsA++; return callsA === 1 ? contested : fallbackA }
  const genB = () => { callsB++; return callsB === 1 ? contested : fallbackB }
  // Distinct dogRefs held by the test itself (not just returned from the
  // call) so both can be checked directly with getDoc() afterward — see
  // the round-17 note on Test 2/4 above for why a list-query check isn't
  // usable here (firestore.rules' dogs `list` rule can't be proven safe
  // by a bare where('passportId', ...) query for a signed-in user).
  const dogRefA = doc(collection(db, 'dogs'))
  const dogRefB = doc(collection(db, 'dogs'))

  const [resA, resB] = await Promise.allSettled([
    createDogAtomic({ creatorUid: uid2, dateOfBirth: '2024-01-01', generateCandidate: genA, dogRef: dogRefA }),
    createDogAtomic({ creatorUid: uid2, dateOfBirth: '2024-01-01', generateCandidate: genB, dogRef: dogRefB }),
  ])

  check('Both concurrent callers eventually succeed (one wins the contested id, the other retries)',
    resA.status === 'fulfilled' && resB.status === 'fulfilled',
    `A=${resA.status}${resA.status === 'rejected' ? ':' + resA.reason?.message : ''} B=${resB.status}${resB.status === 'rejected' ? ':' + resB.reason?.message : ''}`)

  const contestedSnap = await getDoc(doc(db, 'passportReservations', contested))
  check('Exactly one reservation exists for the contested candidate', contestedSnap.exists())

  const winnerDogId = contestedSnap.data()?.dogId
  const winnerRef = winnerDogId === dogRefA.id ? dogRefA : winnerDogId === dogRefB.id ? dogRefB : null
  const loserRef = winnerRef === dogRefA ? dogRefB : winnerRef === dogRefB ? dogRefA : null
  check('The winning reservation is bound to one of the two contending dogRefs', !!winnerRef, `winnerDogId=${winnerDogId}`)

  const winnerDogSnap = winnerRef ? await getDoc(winnerRef) : null
  check('The winning dogRef document carries the contested passportId', winnerDogSnap?.data()?.passportId === contested)

  // The loser must have transparently retried onto its own fallback
  // candidate — not silently failed, and not also written the contested
  // passportId onto its own (different) dogRef.
  const loserDogSnap = loserRef ? await getDoc(loserRef) : null
  check('The losing caller\'s dogRef exists but carries its OWN fallback passportId, not the contested one',
    !!loserDogSnap?.exists() && loserDogSnap.data()?.passportId !== contested,
    `loser passportId=${loserDogSnap?.data()?.passportId}`)
  check('The losing caller\'s fallback passportId is one of its declared fallbacks',
    loserDogSnap?.data()?.passportId === fallbackA || loserDogSnap?.data()?.passportId === fallbackB)
}

// ── Test 6: bounded retry — exhausting every attempt fails safely, no partial state ──
{
  const alwaysTakenId = `MAX-2026-${R}G`
  // createdBy must match whoever is CURRENTLY signed in (rules require
  // request.auth.uid == createdBy on create) — Test 4/5 above left uid2
  // signed in, not uid1.
  const uidForTest = auth.currentUser?.uid
  await setDoc(doc(db, 'passportReservations', alwaysTakenId), { createdAt: new Date().toISOString(), createdBy: uidForTest, dogId: 'x' })

  let calls = 0
  const generateCandidate = () => { calls++; return alwaysTakenId } // always collides

  let threw = false, errorMessage = ''
  try {
    await createDogAtomic({ creatorUid: uidForTest, dateOfBirth: '2024-01-01', generateCandidate })
  } catch (err) {
    threw = true
    errorMessage = err.message
  }
  check('Exhausting all attempts throws rather than silently reusing an ID', threw)
  check('Attempts are bounded at MAX_PASSPORT_ID_ATTEMPTS', calls === MAX_PASSPORT_ID_ATTEMPTS, `calls=${calls}`)
  check('Failure message is safe/generic, not an internal stack trace', errorMessage.includes('unique passport ID'), errorMessage)
}

await summary()
