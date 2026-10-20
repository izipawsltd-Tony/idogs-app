// Emulator-only service integration: real transactions, transfer, claim and
// history handlers. Token verification is stubbed; real Rules/Auth coverage
// lives in test-h8-post-transfer-authorization.mjs.
import { mock } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'demo-idogs-h8'
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error('Emulator-only: refuses every non-demo project')
}
initializeApp({ projectId: PROJECT_ID })
const identities = { former: { uid: 'former', email: 'former@emulator.local' },
  buyer: { uid: 'buyer', email: 'buyer@emulator.local' }, stranger: { uid: 'stranger', email: 'stranger@emulator.local' } }
mock.module('firebase-admin/auth', { namedExports: { getAuth: () => ({ verifyIdToken: async token => {
  if (!identities[token]) throw new Error('Invalid')
  return identities[token]
} }) } })
const { default: transfer } = await import('../api/transfer-dog.js')
const { default: claim } = await import('../api/claim-transferred-dogs.js')
const { default: history } = await import('../api/get-dog-history.js')
const { default: exportReport } = await import('../api/export-report.js')
const db = getFirestore()
for (const uid of ['former', 'buyer', 'stranger']) await db.collection('users').doc(uid).set({ plan: 'plus' })
const collections = ['vaccineRecords', 'wormingRecords', 'healthTests', 'activityNotes', 'documents', 'reminders', 'heatCycles', 'scanLogs']
let passed = 0
function check(value, label) { assert.ok(value, label); passed++; console.log(`PASS: ${label}`) }
async function call(handler, body, token) {
  const res = { code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this },
    setHeader() {}, send(body) { this.body = body; return this } }
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res)
  return res
}

for (const dogId of ['privacy-first', 'privacy-second']) {
  await db.collection('dogs').doc(dogId).set({ name: `Before ${dogId}`, tenantId: 'former', currentOwnerId: 'former',
    sex: 'female', breed: 'Labrador Retriever', dateOfBirth: '2023-01-01', createdAt: '2023-01-01', status: 'active', photos: ['before-photo'], passportId: dogId })
  for (const name of collections) await db.collection(name).doc(`${dogId}-before`).set({ dogId,
    name: 'Before transfer', tenantId: 'former', createdBy: 'former', createdAt: '2026-10-01T00:00:00Z',
    filePath: `documents/former/${dogId}/before.pdf`, status: 'pending' })
  const r = await call(transfer, { dogId, buyerName: 'QA Buyer', buyerEmail: 'buyer@emulator.local' }, 'former')
  check(r.code === 200, `${dogId}: atomic transfer succeeds`)
  const s = await db.collection('ownershipHistorySnapshots').doc(r.body.snapshotId).get()
  check(s.exists && s.data().fromOwnerId === 'former', `${dogId}: snapshot exists with verified former owner`)
  for (const name of collections.filter(n => n !== 'scanLogs')) check(s.data()[name].length === 1, `${dogId}: freezes ${name}`)
  check(s.data().scanCount === 1 && s.data().dog.photos[0] === 'before-photo', `${dogId}: freezes scan count and photos`)
  const pending = await call(history, { action: 'detail', dogId }, 'former')
  check(pending.code === 200 && pending.body.snapshot.id === s.id, `${dogId}: history opens before claim`)
  const duplicate = await call(transfer, { dogId, buyerName: 'Other', buyerEmail: 'other@emulator.local' }, 'former')
  check(duplicate.code === 409, `${dogId}: duplicate pending transfer is rejected`)
}
const claimed = await call(claim, { action: 'claim' }, 'buyer')
check(claimed.code === 200 && claimed.body.claimed === 2, 'actual claim handler accepts both dogs')
for (const dogId of ['privacy-first', 'privacy-second']) {
  check((await db.collection('dogs').doc(dogId).get()).data().currentOwnerId === 'buyer', `${dogId}: current owner changes to buyer`)
  await db.collection('dogs').doc(dogId).update({ name: 'PRIVATE AFTER TRANSFER', photos: ['PRIVATE NEW PHOTO'] })
  for (const name of collections) {
    // Test both a backdated NEW entry and an edit of an existing old entry.
    await db.collection(name).doc(`${dogId}-after`).set({ dogId, name: 'PRIVATE AFTER TRANSFER',
      dateGiven: '2020-01-01', createdAt: new Date().toISOString(), tenantId: 'former' })
    await db.collection(name).doc(`${dogId}-before`).update({ name: 'PRIVATE EDIT OF OLD RECORD' })
  }
  const old = await call(history, { action: 'detail', dogId }, 'former')
  check(old.code === 200 && old.body.snapshot.dog.name === `Before ${dogId}`, `${dogId}: former owner can open frozen dog after claim`)
  check(!JSON.stringify(old.body).includes('PRIVATE'), `${dogId}: new entries, backdated dates, edits and photos cannot leak`)
  check(old.body.snapshot.scanCount === 1, `${dogId}: scan count remains frozen`)
  const outsider = await call(history, { action: 'detail', dogId, fromOwnerId: 'former' }, 'stranger')
  check(outsider.code === 404, `${dogId}: stranger cannot spoof former owner`)
  const buyerHistory = await call(history, { action: 'detail', dogId }, 'buyer')
  check(buyerHistory.code === 404, `${dogId}: snapshot is private to former owner`)
  const denied = await call(transfer, { dogId, buyerName: 'Other', buyerEmail: 'other@emulator.local' }, 'former')
  check(denied.code === 403, `${dogId}: former owner cannot transfer the live dog again`)
  for (const scope of ['dog', 'breeding']) {
    const report = await call(exportReport, { scope, id: dogId, tenantId: 'former', format: 'pdf' }, 'former')
    check(report.code === 200 && !JSON.stringify(report.body).includes('PRIVATE'), `${dogId}: ${scope} export uses frozen history only`)
    const strangerReport = await call(exportReport, { scope, id: dogId, tenantId: 'stranger', format: 'pdf' }, 'stranger')
    check(strangerReport.code === 403, `${dogId}: stranger cannot export ${scope} records`)
  }
}
const listed = await call(history, { action: 'list' }, 'former')
check(listed.code === 200 && listed.body.dogs.length === 2, 'former-owner list includes both snapshots')
const kennel = await call(exportReport, { scope: 'kennel', tenantId: 'former', format: 'pdf' }, 'former')
check(kennel.code === 200 && !JSON.stringify(kennel.body).includes('PRIVATE'), 'former-owner kennel export excludes the buyer live dogs')
await db.collection('litters').doc('privacy-litter').set({ tenantId: 'former', name: 'QA litter', puppyIds: ['privacy-first', 'privacy-second'] })
const litter = await call(exportReport, { scope: 'litter', id: 'privacy-litter', tenantId: 'former', format: 'pdf' }, 'former')
check(litter.code === 200 && !JSON.stringify(litter.body).includes('PRIVATE'), 'litter export uses frozen puppy histories')
const buyerReport = await call(exportReport, { scope: 'dog', id: 'privacy-first', tenantId: 'buyer', format: 'pdf' }, 'buyer')
check(buyerReport.code === 200 && JSON.stringify(buyerReport.body).includes('PRIVATE'), 'current owner still exports their live records')
await db.collection('dogs').doc('privacy-legacy-no-snapshot').set({ tenantId: 'former', currentOwnerId: 'buyer', name: 'PRIVATE LEGACY DOG' })
const noSnapshot = await call(exportReport, { scope: 'dog', id: 'privacy-legacy-no-snapshot', tenantId: 'former', format: 'pdf' }, 'former')
check(noSnapshot.code === 403 && !JSON.stringify(noSnapshot.body).includes('PRIVATE'), 'legacy missing snapshot never falls back to live export')
const otherLitter = await call(exportReport, { scope: 'litter', id: 'privacy-litter', tenantId: 'stranger', format: 'pdf' }, 'stranger')
check(otherLitter.code === 403, 'stranger cannot export another tenant litter')
const wrongIdentity = await call(exportReport, { scope: 'kennel', tenantId: 'buyer', format: 'pdf' }, 'former')
check(wrongIdentity.code === 403, 'kennel export rejects spoofed tenant identity')
console.log(`\n${passed} passed, 0 failed`)
