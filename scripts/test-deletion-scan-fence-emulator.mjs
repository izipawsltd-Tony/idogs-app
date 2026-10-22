import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { recordPassportScan, requireAccountWrites } from '../api/_lib/account-write-fence.js'

const projectId = 'demo-idogs-account-deletion'
if (process.env.GCLOUD_PROJECT !== projectId || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('emulator_only')
let app, db, seq = 0
before(() => { app = initializeApp({ projectId }, 'scan-fence'); db = getFirestore(app) })
after(async () => { await db?.terminate(); if (app) await deleteApp(app) })
async function fixture(state, dog = {}) {
  const uid = `qa-scan-fence-${++seq}`, dogId = `${uid}-dog`, passportId = `${uid}-passport`
  await db.doc(`dogs/${dogId}`).set({ currentOwnerId: uid, tenantId: 'former-breeder', passportId, ...dog })
  if (state) await db.doc(`accountDeletionFences/${uid}`).set(state)
  return { uid, dogId, passportId, count: async () => (await db.collection('scanLogs').where('dogId', '==', dogId).get()).size }
}
for (const state of [undefined, { state: 'open' }, { state: 'frozen' }, { state: 'completed' }, {}]) {
  test(`server QR scan uses committed owner and ${state?.state || (state ? 'malformed' : 'absent')} fence`, async () => {
    const f = await fixture(state), allowed = !state || state.state === 'open'
    assert.equal(await recordPassportScan({ db, ...f }), allowed)
    assert.equal(await f.count(), allowed ? 1 : 0)
  })
}
test('a frozen former breeder does not stop logging for the current owner', async () => {
  const f = await fixture(undefined, { tenantId: 'qa-scan-frozen-breeder' })
  await db.doc('accountDeletionFences/qa-scan-frozen-breeder').set({ state: 'frozen' })
  assert.equal(await recordPassportScan({ db, ...f }), true)
})
test('missing dog, mismatched passport and malformed owner cannot create orphan scan records', async () => {
  const f = await fixture(undefined, { currentOwnerId: null })
  for (const args of [f, { ...f, dogId: 'missing-qa-dog' }, { ...f, passportId: 'forged-passport' }]) {
    assert.equal(await recordPassportScan({ db, ...args }), false)
  }
  assert.equal(await f.count(), 0)
})
test('legacy owner fallback is used only when currentOwnerId is absent', async () => {
  const f = await fixture(undefined)
  await db.doc(`dogs/${f.dogId}`).set({ tenantId: f.uid, passportId: f.passportId })
  assert.equal(await recordPassportScan({ db, ...f }), true)
  await db.doc(`accountDeletionFences/${f.uid}`).set({ state: 'frozen' })
  assert.equal(await recordPassportScan({ db, ...f }), false)
  assert.equal(await f.count(), 1)
})
test('server guard and the data write share a transaction; frozen writes leave no result', async () => {
  const f = await fixture({ state: 'frozen' }), ref = db.doc(`documents/${f.uid}`)
  await assert.rejects(db.runTransaction(async tx => {
    await requireAccountWrites(tx, db, f.uid)
    tx.create(ref, { dogId: f.dogId })
  }), error => error.code === 'account_writes_frozen' && error.status === 409)
  assert.equal((await ref.get()).exists, false)
})
test('scan racing freeze serializes before it or stops; every later scan is blocked', async () => {
  const f = await fixture({ state: 'open' })
  await Promise.all([recordPassportScan({ db, ...f }), db.doc(`accountDeletionFences/${f.uid}`).set({ state: 'frozen' })])
  const atFreeze = await f.count()
  assert.ok(atFreeze === 0 || atFreeze === 1)
  const later = await Promise.all(Array.from({ length: 5 }, () => recordPassportScan({ db, ...f })))
  assert.deepEqual(later, [false, false, false, false, false])
  assert.equal(await f.count(), atFreeze)
})
