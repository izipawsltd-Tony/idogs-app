// Phase "Document Consistency Fixes" — emulator regression test for the
// getAllDocumentsForUser() query pattern: derive accessible dog IDs from
// getDogs() (tenantId OR currentOwnerId, minus 'transferred'-for-former-
// breeder), then fetch documents per dogId via the same dogBelongsToUser
// rule getDogDocuments() already uses. No firestore.rules change — this
// only proves the query shape works and stays correctly scoped.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-document-continuity.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)
async function simulateAdminClaim(dogId, newCurrentOwnerId) {
  await adminDb.collection('dogs').doc(dogId).update({ currentOwnerId: newCurrentOwnerId, status: 'active' })
}

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// Re-implementation of getAllDocumentsForUser()'s logic against the client
// SDK, mirroring src/lib/db.ts exactly, so this test exercises the real
// query shapes without needing to import the app's Vite-bundled module.
async function getDogsFor(uid) {
  const [breederSnap, ownerSnap] = await Promise.all([
    getDocs(query(collection(db, 'dogs'), where('tenantId', '==', uid))),
    getDocs(query(collection(db, 'dogs'), where('currentOwnerId', '==', uid))),
  ])
  const map = new Map()
  breederSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }))
  ownerSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }))
  return Array.from(map.values()).map(dog => {
    if (dog.tenantId === uid && dog.currentOwnerId !== uid) return { ...dog, status: 'transferred' }
    return dog
  })
}
async function getDogDocumentsFor(dogId) {
  const snap = await getDocs(query(collection(db, 'documents'), where('dogId', '==', dogId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}
async function getAllDocumentsForUserFor(uid) {
  const dogs = await getDogsFor(uid)
  const accessibleIds = dogs.filter(d => d.status !== 'transferred').map(d => d.id)
  if (accessibleIds.length === 0) return []
  const perDog = await Promise.all(accessibleIds.map(id => getDogDocumentsFor(id).catch(() => [])))
  return perDog.flat()
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `doccont.${n}.${R}@emulator.local`
async function newUser(name) { const { user } = await createUserWithEmailAndPassword(auth, email(name), PW); await signOut(auth); return user.uid }
async function as(name) { await signOut(auth).catch(() => {}); await signInWithEmailAndPassword(auth, email(name), PW) }

const breederUid = await newUser('breeder')
const newOwnerUid = await newUser('newowner')
const strangerUid = await newUser('stranger')
const ownerCreatorUid = await newUser('ownercreator')

// ── Breeder-owned dog with a document ──
const breederDogId = `bDog_${R}`
await as('breeder')
await setDoc(doc(db, 'dogs', breederDogId), { tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid, sourceType: 'BREEDER_ISSUED', status: 'active', dateOfBirth: '2020-01-01' })
await setDoc(doc(db, 'documents', `bDoc_${R}`), { dogId: breederDogId, tenantId: breederUid, documentType: 'vaccine_card' })

let breederDocs = await getAllDocumentsForUserFor(breederUid)
check('Breeder sees their own dog\'s document', breederDocs.some(d => d.dogId === breederDogId))

// ── Owner-created dog with a document ──
const ownerCreatedDogId = `ocDog_${R}`
await as('ownercreator')
await setDoc(doc(db, 'dogs', ownerCreatedDogId), { tenantId: ownerCreatorUid, currentOwnerId: ownerCreatorUid, createdByUserId: ownerCreatorUid, sourceType: 'OWNER_CREATED', status: 'active', dateOfBirth: '2020-01-01' })
await setDoc(doc(db, 'documents', `ocDoc_${R}`), { dogId: ownerCreatedDogId, tenantId: ownerCreatorUid, documentType: 'other' })
let ocDocs = await getAllDocumentsForUserFor(ownerCreatorUid)
check('Owner sees their own owner-created dog\'s document', ocDocs.some(d => d.dogId === ownerCreatedDogId))

// ── Transfer + claim: pre-transfer document must follow to new owner ──
const claimDogId = `claimDog_${R}`
await as('breeder')
await setDoc(doc(db, 'dogs', claimDogId), { tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid, sourceType: 'BREEDER_ISSUED', status: 'active', dateOfBirth: '2020-01-01' })
await setDoc(doc(db, 'documents', `claimDoc_${R}`), { dogId: claimDogId, tenantId: breederUid, documentType: 'pedigree' })

// former breeder currently still sees it (still current owner at this point)
let preClaimDocs = await getAllDocumentsForUserFor(breederUid)
check('Breeder sees pre-transfer document before claim', preClaimDocs.some(d => d.dogId === claimDogId))

// simulate claim (server-side Admin SDK — bypasses rules, matches production)
await simulateAdminClaim(claimDogId, newOwnerUid)

await as('newowner')
let newOwnerDocs = await getAllDocumentsForUserFor(newOwnerUid)
check('New owner sees pre-transfer document after claim (continuity)', newOwnerDocs.some(d => d.dogId === claimDogId))

await as('breeder')
let formerBreederDocs = await getAllDocumentsForUserFor(breederUid)
check('Former breeder no longer sees the transferred-away dog\'s document', !formerBreederDocs.some(d => d.dogId === claimDogId))
// breeder's OWN still-owned dog document must remain visible (not a blanket wipe)
check('Former breeder still sees their own still-owned dog\'s document', formerBreederDocs.some(d => d.dogId === breederDogId))

// ── Unrelated user denial ──
await as('stranger')
const strangerDocs = await getAllDocumentsForUserFor(strangerUid)
check('Unrelated user\'s aggregation returns nothing (no accessible dogs)', strangerDocs.length === 0, `got ${strangerDocs.length}`)

let strangerDirectDenied = false
try {
  await getDocs(query(collection(db, 'documents'), where('dogId', '==', claimDogId)))
} catch (err) {
  strangerDirectDenied = err.code === 'permission-denied' || /permission/i.test(err.message)
}
check('Unrelated user directly querying a dog they don\'t own is denied', strangerDirectDenied)

await summary()
