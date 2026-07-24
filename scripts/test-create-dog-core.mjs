// scripts/test-create-dog-core.mjs — pure-logic tests for
// api/_lib/create-dog-core.js's createDogWithRetry() against the
// in-memory Firestore fake (no emulator required) — exercises the REAL
// exported function, not a reimplementation. Complements
// scripts/test-passport-uniqueness.mjs (same function, against a real
// Firestore emulator) with a genuine two-caller concurrency scenario,
// which the fake's serialized-transaction-queue makes fast and
// deterministic to prove (see fake-firestore.mjs's own comment on why
// that serialization is a safe over-approximation for exactly this kind
// of "does the second caller ever observe pre-write state" property).
//
// Usage: node scripts/test-create-dog-core.mjs

import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { createDogWithRetry, MAX_PASSPORT_ID_ATTEMPTS, generateCandidate } from '../api/_lib/create-dog-core.js'

const { check, checkAsync, summary } = makeChecker()

check('MAX_PASSPORT_ID_ATTEMPTS is bounded (sane, non-infinite retry budget)', MAX_PASSPORT_ID_ATTEMPTS > 0 && MAX_PASSPORT_ID_ATTEMPTS <= 10)
check('generateCandidate() produces a NAME-YEAR-XXXX shaped id from name/dateOfBirth', /^TES-2024-[A-Z0-9]{4}$/.test(generateCandidate('Test', '2024-01-01')))
check('generateCandidate() falls back to "DOG" when name is empty/missing', generateCandidate('', '2024-01-01').startsWith('DOG-2024-'))

function minimalDogData(candidate, overrides = {}) {
  return { name: 'Test', dateOfBirth: '2024-01-01', status: 'active', passportId: candidate, ...overrides }
}

await checkAsync('Succeeds on the first attempt with a unique candidate — reservation and dog both land, bound to the same dogId', async () => {
  const db = createFakeFirestore()
  const dogRef = db.collection('dogs').doc()
  const result = await createDogWithRetry({
    db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
    buildDogData: async (tx, candidate) => minimalDogData(candidate),
    generateCandidateFn: () => 'FIXED-2024-AAAA',
  })
  const dogSnap = await dogRef.get()
  const reservationSnap = await db.collection('passportReservations').doc('FIXED-2024-AAAA').get()
  return result.dogId === dogRef.id &&
    result.passportId === 'FIXED-2024-AAAA' &&
    dogSnap.data().passportId === 'FIXED-2024-AAAA' &&
    reservationSnap.exists &&
    reservationSnap.data().dogId === dogRef.id &&
    reservationSnap.data().createdBy === 'uid-1'
})

await checkAsync('buildDogData\'s returned status flows through to both the transaction write and the returned result (cap-aware status pass-through)', async () => {
  const db = createFakeFirestore()
  const dogRef = db.collection('dogs').doc()
  const result = await createDogWithRetry({
    db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
    buildDogData: async (tx, candidate) => minimalDogData(candidate, { status: 'restricted' }),
    generateCandidateFn: () => 'CAP-2024-AAAA',
  })
  return result.status === 'restricted' && (await dogRef.get()).data().status === 'restricted'
})

await checkAsync('On a reservation collision, retries with a fresh candidate — the SAME dogRef is reused, never regenerated', async () => {
  const db = createFakeFirestore({
    passportReservations: { 'TAKEN-2024-AAAA': { createdAt: 'x', createdBy: 'someone-else', dogId: 'other-dog' } },
  })
  const dogRef = db.collection('dogs').doc()
  let calls = 0
  const generateCandidateFn = () => { calls++; return calls === 1 ? 'TAKEN-2024-AAAA' : 'FRESH-2024-BBBB' }
  const result = await createDogWithRetry({
    db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
    buildDogData: async (tx, candidate) => minimalDogData(candidate),
    generateCandidateFn,
  })
  return calls === 2 && result.dogId === dogRef.id && result.passportId === 'FRESH-2024-BBBB'
})

await checkAsync('The colliding reservation is left completely unchanged after a retry succeeds elsewhere', async () => {
  const db = createFakeFirestore({
    passportReservations: { 'TAKEN-2024-CCCC': { createdAt: 'x', createdBy: 'someone-else', dogId: 'other-dog' } },
  })
  const dogRef = db.collection('dogs').doc()
  let calls = 0
  await createDogWithRetry({
    db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
    buildDogData: async (tx, candidate) => minimalDogData(candidate),
    generateCandidateFn: () => { calls++; return calls === 1 ? 'TAKEN-2024-CCCC' : 'FRESH-2024-DDDD' },
  })
  const takenSnap = await db.collection('passportReservations').doc('TAKEN-2024-CCCC').get()
  return takenSnap.data().dogId === 'other-dog'
})

await checkAsync('Exhausting every attempt (always colliding) throws a safe generic error, bounded at MAX_PASSPORT_ID_ATTEMPTS, no orphan dog written', async () => {
  const db = createFakeFirestore({
    passportReservations: { 'ALWAYS-2024-EEEE': { createdAt: 'x', createdBy: 'someone-else', dogId: 'blocker' } },
  })
  const dogRef = db.collection('dogs').doc()
  let calls = 0
  let threw = false, message = ''
  try {
    await createDogWithRetry({
      db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
      buildDogData: async (tx, candidate) => minimalDogData(candidate),
      generateCandidateFn: () => { calls++; return 'ALWAYS-2024-EEEE' },
    })
  } catch (err) {
    threw = true
    message = err.message
  }
  const dogSnap = await dogRef.get()
  return threw && calls === MAX_PASSPORT_ID_ATTEMPTS && message.includes('unique passport ID') && !dogSnap.exists
})

await checkAsync('A non-collision error thrown from buildDogData propagates immediately — no retry attempted, not swallowed', async () => {
  const db = createFakeFirestore()
  const dogRef = db.collection('dogs').doc()
  let calls = 0
  let threw = false, message = ''
  try {
    await createDogWithRetry({
      db, dogRef, reservationCreatedBy: 'uid-1', name: 'Test', dateOfBirth: '2024-01-01',
      buildDogData: async () => { throw new Error('SOME_OTHER_FAILURE') },
      generateCandidateFn: () => { calls++; return `X-2024-${calls}` },
    })
  } catch (err) {
    threw = true
    message = err.message
  }
  return threw && message === 'SOME_OTHER_FAILURE' && calls === 1
})

await checkAsync('Two callers racing the SAME first-attempt candidate: exactly one wins it, the other transparently retries onto its own fresh candidate — neither is lost, neither silently overwrites the other', async () => {
  const db = createFakeFirestore()
  const contested = 'RACE-2024-FFFF'
  const dogRefA = db.collection('dogs').doc()
  const dogRefB = db.collection('dogs').doc()
  let callsA = 0, callsB = 0
  const genA = () => { callsA++; return callsA === 1 ? contested : 'RACE-2024-A-FALLBACK' }
  const genB = () => { callsB++; return callsB === 1 ? contested : 'RACE-2024-B-FALLBACK' }

  const [resA, resB] = await Promise.all([
    createDogWithRetry({ db, dogRef: dogRefA, reservationCreatedBy: 'uid-A', name: 'Test', dateOfBirth: '2024-01-01', buildDogData: async (tx, c) => minimalDogData(c), generateCandidateFn: genA }),
    createDogWithRetry({ db, dogRef: dogRefB, reservationCreatedBy: 'uid-B', name: 'Test', dateOfBirth: '2024-01-01', buildDogData: async (tx, c) => minimalDogData(c), generateCandidateFn: genB }),
  ])

  const contestedSnap = await db.collection('passportReservations').doc(contested).get()
  const winnerIsA = contestedSnap.data().dogId === dogRefA.id
  const winnerIsB = contestedSnap.data().dogId === dogRefB.id
  const winnerRes = winnerIsA ? resA : resB
  const loserRes = winnerIsA ? resB : resA

  return (winnerIsA || winnerIsB) &&
    winnerRes.passportId === contested &&
    loserRes.passportId !== contested &&
    resA.dogId === dogRefA.id && resB.dogId === dogRefB.id
})

await summary()
