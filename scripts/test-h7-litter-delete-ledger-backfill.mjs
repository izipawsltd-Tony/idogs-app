// scripts/test-h7-litter-delete-ledger-backfill.mjs — Codex H1/H5/H7/H8
// remediation round 2, H7: hard-deleting a pre-ledger (whelped, but never
// litterQuotaLedger-backed) litter must not silently free up its rolling-
// window quota slot. Imports the REAL api/delete-litter.js handler and
// the REAL api/_lib/litter-quota.js functions directly (not a hand-copied
// mirror) — this round's instructions require behavioral tests against
// the actual code, not source-text assertions or a drift-prone re-
// implementation. Same established pattern as
// scripts/test-passport-uniqueness.mjs / test-claim-transferred-dogs.mjs.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. node scripts/test-h7-litter-delete-ledger-backfill.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
import './test-helpers/emulator-credentials.mjs'

const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK.
const { default: deleteLitterHandler } = await import('../api/delete-litter.js')
const { hasLitterWithinRollingWindow, hasLedgerEntryForLitter } = await import('../api/_lib/litter-quota.js')

const seedDb = getFirestore()

const { initializeApp } = await import('firebase/app')
const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'h7-ledger-backfill-client')
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

const { makeChecker } = await import('./_lib/test-check.mjs')
const { check, checkAsync, summary } = makeChecker()

function mockReq({ token, litterId, method = 'POST' } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { litterId } }
}
function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = c => { res.statusCode = c; return res }
  res.json = p => { res.body = p; return res }
  return res
}

const R = Date.now()
async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(clientAuth, `${name}.${R}@emulator.local`, 'tam12345*')
  const idToken = await user.getIdToken()
  return { uid: user.uid, idToken }
}

async function seedDam(uid, id) {
  await seedDb.collection('dogs').doc(id).set({
    tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
}
async function ledgerEntriesFor(litterId) {
  const snap = await seedDb.collection('litterQuotaLedger').where('litterId', '==', litterId).get()
  return snap.docs.map(d => d.data())
}

// ── Test 1: a pre-ledger dated litter still counts toward quota after being hard-deleted ──
{
  const user = await newUser('h7owner1')
  const damId = `dam1_${R}`
  await seedDam(user.uid, damId)
  const litterId = `litter1_${R}`
  const whelpingDate = '2026-06-01'
  await seedDb.collection('litters').doc(litterId).set({
    tenantId: user.uid, damId, name: 'PreLedger', notes: '', actualBirthDate: whelpingDate, puppyIds: [],
  })
  // Sanity: no ledger entry exists yet — this is the pre-ledger scenario.
  check('Sanity: the seeded litter has no pre-existing ledger entry', (await ledgerEntriesFor(litterId)).length === 0)

  const req = mockReq({ token: user.idToken, litterId })
  const res = mockRes()
  await deleteLitterHandler(req, res)
  check('delete-litter.js hard-deletes the pre-ledger litter (200, litterDeleted)', res.statusCode === 200 && res.body?.litterDeleted === true, JSON.stringify(res.body))

  const litterSnap = await seedDb.collection('litters').doc(litterId).get()
  check('The litter document is genuinely gone', !litterSnap.exists)

  const entries = await ledgerEntriesFor(litterId)
  check('Exactly one ledger entry was backfilled for the deleted litter', entries.length === 1, `got ${entries.length}`)
  check('The backfilled entry carries the correct tenantId and whelpingDate', entries[0]?.tenantId === user.uid && entries[0]?.whelpingDate === whelpingDate)

  await checkAsync('hasLitterWithinRollingWindow now finds this litter via the LEDGER alone (the live document is gone) — a new litter 30 days later is still blocked', async () => {
    return seedDb.runTransaction(tx => hasLitterWithinRollingWindow(tx, seedDb, user.uid, '2026-06-30'))
  })
  await checkAsync('a genuinely distant new litter date (>365 days away) is NOT blocked — the fix does not over-block', async () => {
    const blocked = await seedDb.runTransaction(tx => hasLitterWithinRollingWindow(tx, seedDb, user.uid, '2028-01-01'))
    return !blocked
  })
}

// ── Test 2: a litter that ALREADY has a ledger entry is not double-counted on delete ──
{
  const user = await newUser('h7owner2')
  const damId = `dam2_${R}`
  await seedDam(user.uid, damId)
  const litterId = `litter2_${R}`
  const whelpingDate = '2026-05-01'
  await seedDb.collection('litters').doc(litterId).set({
    tenantId: user.uid, damId, name: 'AlreadyLedgered', notes: '', actualBirthDate: whelpingDate, puppyIds: [],
  })
  // Simulate the NORMAL creation-time ledger write (create-litter.js/update-litter.js already does this).
  await seedDb.collection('litterQuotaLedger').add({ tenantId: user.uid, litterId, whelpingDate, recordedAt: new Date().toISOString() })
  check('Sanity: exactly one ledger entry exists before delete', (await ledgerEntriesFor(litterId)).length === 1)

  const req = mockReq({ token: user.idToken, litterId })
  const res = mockRes()
  await deleteLitterHandler(req, res)
  check('delete-litter.js hard-deletes an already-ledgered litter normally', res.statusCode === 200 && res.body?.litterDeleted === true)

  const entries = await ledgerEntriesFor(litterId)
  check('Still EXACTLY one ledger entry — delete did not create a duplicate', entries.length === 1, `got ${entries.length}`)
}

// ── Test 3: cross-tenant denial — the whole transaction (including any ledger backfill) aborts atomically ──
{
  const owner = await newUser('h7owner3')
  const stranger = await newUser('h7stranger3')
  const damId = `dam3_${R}`
  await seedDam(owner.uid, damId)
  const litterId = `litter3_${R}`
  const whelpingDate = '2026-04-01'
  await seedDb.collection('litters').doc(litterId).set({
    tenantId: owner.uid, damId, name: 'CrossTenantTarget', notes: '', actualBirthDate: whelpingDate, puppyIds: [],
  })

  const req = mockReq({ token: stranger.idToken, litterId })
  const res = mockRes()
  await deleteLitterHandler(req, res)
  check('A stranger attempting to delete someone else\'s litter is denied (403)', res.statusCode === 403, JSON.stringify(res.body))

  const litterSnap = await seedDb.collection('litters').doc(litterId).get()
  check('The litter document is untouched (still exists) after the denied attempt', litterSnap.exists)
  const entries = await ledgerEntriesFor(litterId)
  check('No ledger entry was created by the denied (aborted) attempt — atomic, all-or-nothing', entries.length === 0, `got ${entries.length}`)
}

// ── Test 4: repeated delete (idempotent retry) never double-writes the ledger ──
{
  const user = await newUser('h7owner4')
  const damId = `dam4_${R}`
  await seedDam(user.uid, damId)
  const litterId = `litter4_${R}`
  const whelpingDate = '2026-03-01'
  await seedDb.collection('litters').doc(litterId).set({
    tenantId: user.uid, damId, name: 'RetryTarget', notes: '', actualBirthDate: whelpingDate, puppyIds: [],
  })

  const req1 = mockReq({ token: user.idToken, litterId })
  const res1 = mockRes()
  await deleteLitterHandler(req1, res1)
  check('First delete succeeds and backfills the ledger', res1.statusCode === 200 && res1.body?.litterDeleted === true)

  const req2 = mockReq({ token: user.idToken, litterId })
  const res2 = mockRes()
  await deleteLitterHandler(req2, res2)
  check('Retrying the delete on an already-deleted litter is a harmless no-op (200, notFound), not an error', res2.statusCode === 200 && res2.body?.notFound === true, JSON.stringify(res2.body))

  const entries = await ledgerEntriesFor(litterId)
  check('The retry did not create a second ledger entry', entries.length === 1, `got ${entries.length}`)
}

// ── Test 5: preserved-dog behavior is unaffected — archived litters need no ledger backfill (the live doc IS the evidence) ──
{
  const user = await newUser('h7owner5')
  const damId = `dam5_${R}`
  await seedDam(user.uid, damId)
  const litterId = `litter5_${R}`
  const whelpingDate = '2026-02-01'
  const transferredPupId = `pup5_${R}`
  await seedDb.collection('dogs').doc(transferredPupId).set({
    tenantId: user.uid, currentOwnerId: 'someone-else', createdByUserId: user.uid,
    sourceType: 'BREEDER_ISSUED', name: 'TransferredPup', sex: 'male', status: 'transferred',
    dateOfBirth: whelpingDate, litterId, buyerEmail: 'buyer@example.com', transferredAt: new Date().toISOString(),
  })
  await seedDb.collection('litters').doc(litterId).set({
    tenantId: user.uid, damId, name: 'HasPreservedPup', notes: '', actualBirthDate: whelpingDate, puppyIds: [transferredPupId],
  })

  const req = mockReq({ token: user.idToken, litterId })
  const res = mockRes()
  await deleteLitterHandler(req, res)
  check('A litter with a preserved (transferred) puppy is ARCHIVED, not hard-deleted', res.statusCode === 200 && res.body?.litterArchived === true && res.body?.litterDeleted === false, JSON.stringify(res.body))

  const litterSnap = await seedDb.collection('litters').doc(litterId).get()
  check('The litter document still exists (archived, not deleted) — it remains its own quota evidence', litterSnap.exists && litterSnap.data()?.archived === true)

  const entries = await ledgerEntriesFor(litterId)
  check('No ledger backfill was written for the archived path — the live document already serves as evidence, no backfill needed', entries.length === 0, `got ${entries.length}`)

  await checkAsync('hasLitterWithinRollingWindow still finds this archived-but-live litter via the live-collection fallback (unaffected regression check)', async () => {
    return seedDb.runTransaction(tx => hasLitterWithinRollingWindow(tx, seedDb, user.uid, '2026-02-15'))
  })
}

// ── Test 6: unit coverage for hasLedgerEntryForLitter itself ──
await checkAsync('hasLedgerEntryForLitter returns false for a litterId with no entries', async () => {
  const litterId = `nonexistent_${R}`
  const result = await seedDb.runTransaction(tx => hasLedgerEntryForLitter(tx, seedDb, litterId))
  return result === false
})
await checkAsync('hasLedgerEntryForLitter returns true once an entry exists', async () => {
  const litterId = `haslentry_${R}`
  await seedDb.collection('litterQuotaLedger').add({ tenantId: 'x', litterId, whelpingDate: '2026-01-01', recordedAt: new Date().toISOString() })
  const result = await seedDb.runTransaction(tx => hasLedgerEntryForLitter(tx, seedDb, litterId))
  return result === true
})

await summary()
