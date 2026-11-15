// Real Firestore server timestamps and history handler. Auth is stubbed;
// Storage metadata is synthetic. Refuses every non-demo project.
import { mock } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { prepareRecovery } from './prepare-legacy-history-recovery.mjs'
const project = 'demo-idogs-h8'
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== project) throw Error('EMULATOR_ONLY')
initializeApp({ projectId: project })
mock.module('firebase-admin/auth', { namedExports: { getAuth: () => ({ verifyIdToken: async token => ({ uid: token }) }) } })
const { default: history } = await import('../api/get-dog-history.js')
const db = getFirestore(), dogId = 'legacy-recovery-dog', former = 'legacy-former', buyer = 'legacy-buyer'
const prefix = `dogs/${former}/${dogId}/`
await db.collection('vaccineRecords').doc('legacy-old-vaccine').set({ dogId, name: 'Original vaccine', dateGiven: '2020-01-01' })
await db.collection('wormingRecords').doc('legacy-old-worming').set({ dogId, product: 'Original worming' })
await db.collection('wormingRecords').doc('legacy-edited-worming').set({ dogId, product: 'Before edit' })
await db.collection('activityNotes').doc('legacy-old-note').set({ dogId, note: 'Original note', photoUrl: `https://storage.googleapis.com/test-bucket/${prefix}notes/old.jpg` })
const mediaTime = new Date().toISOString()
await new Promise(r => setTimeout(r, 10))
const cutoff = new Date().toISOString()
await new Promise(r => setTimeout(r, 10))
await db.collection('vaccineRecords').doc('legacy-gap-vaccine').set({ dogId, name: 'PRIVATE added before audit' })
await new Promise(r => setTimeout(r, 10))
await db.collection('auditLogs').doc('legacy-transfer').set({ tenantId: former, dogId, dogName: 'Original dog name', action: 'dog_transferred', createdAt: new Date().toISOString() })
await db.collection('dogs').doc(dogId).set({ tenantId: former, previousOwnerId: former, currentOwnerId: buyer, transferredAt: cutoff, name: 'PRIVATE current name', profilePhoto: `https://storage.googleapis.com/test-bucket/${prefix}profile.jpg`, photos: [{ path: `${prefix}photos/old.jpg` }, { path: `dogs/${buyer}/${dogId}/photos/private.jpg` }] })
await new Promise(r => setTimeout(r, 10))
await db.collection('vaccineRecords').doc('legacy-backdated').set({ dogId, name: 'PRIVATE backdated vaccine', dateGiven: '2000-01-01', createdAt: '2000-01-01' })
await db.collection('wormingRecords').doc('legacy-edited-worming').update({ product: 'PRIVATE edited worming' })
const bucket = { name: 'test-bucket', file: () => ({ getMetadata: async () => [{ generation: '100', timeCreated: mediaTime, updated: mediaTime }] }) }
const plan = await prepareRecovery({ db, bucket, dogId, fromOwnerId: former })
assert.equal(plan.snapshot.transferredAt, cutoff)
assert.equal(plan.snapshot.vaccineRecords.length, 1)
assert.equal(plan.snapshot.wormingRecords.length, 1)
assert.equal(plan.snapshot.activityNotes.length, 1)
assert.equal(plan.snapshot.recoveredMedia.length, 3)
assert.equal(plan.snapshot.activityNotes[0].photoUrl, undefined)
assert.equal(JSON.stringify(plan).includes('PRIVATE'), false)
// Store only in the explicitly guarded local demo emulator.
await db.collection('ownershipHistorySnapshots').doc(plan.id).create(plan.snapshot)
await db.collection('vaccineRecords').doc('legacy-old-vaccine').update({ name: 'PRIVATE later edit' })
async function call(uid, action = 'detail') {
  const res = { code: 200, status(n) { this.code = n; return this }, json(b) { this.body = b; return this } }
  await history({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body: { action, dogId } }, res)
  return res
}
const result = await call(former)
assert.equal(result.code, 200)
assert.equal(result.body.snapshot.historyAvailability, 'recovered_partial')
assert.equal(result.body.snapshot.dog.name, 'Original dog name')
assert.equal(result.body.snapshot.vaccineRecords[0].name, 'Original vaccine')
assert.equal(result.body.snapshot.recoveredMedia.length, 3)
assert.equal(result.body.snapshot.recoveredMedia[0].path, undefined)
assert.equal(JSON.stringify(result.body).includes('PRIVATE'), false)
assert.equal((await call(buyer)).code, 404)
assert.equal((await call('stranger')).code, 404)
assert.equal((await call(former, 'list')).body.dogs.find(d => d.id === dogId).historyAvailability, 'recovered_partial')
await assert.rejects(prepareRecovery({ db, bucket, dogId, fromOwnerId: former }), /HISTORY_ALREADY_EXISTS/)
console.log('PASS: real Firestore recovery → frozen history → later edit isolation; buyer/stranger denied; duplicate recovery refused')
