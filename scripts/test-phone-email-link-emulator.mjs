// Synthetic Auth + Firestore Emulator E2E. No SMS, email, Stripe or real cloud.
import assert from 'node:assert/strict'
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminDb } from 'firebase-admin/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, connectAuthEmulator, signInWithCustomToken, EmailAuthProvider,
  linkWithCredential, signOut, signInWithEmailAndPassword,
} from 'firebase/auth'

const project = 'demo-idogs-phone-link'
if (process.env.GCLOUD_PROJECT !== project ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Refusing to run outside isolated Firebase Emulators')
}
const adminApp = initializeAdminApp({ projectId: project }, 'phone-link-qa-admin')
const authAdmin = getAdminAuth(adminApp)
const db = getAdminDb(adminApp)
const client = initializeApp({ apiKey: 'emulator-only-key', authDomain: 'localhost', projectId: project, appId: 'synthetic-qa' }, 'phone-link-qa-client')
const auth = getAuth(client)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
const uid = 'existing-phone-qa'
const email = 'qa-phone-link@example.invalid'
const password = 'Synthetic-Password-2026!'
try {
  await authAdmin.createUser({ uid, phoneNumber: '+61400000988' })
  await db.doc('users/' + uid).set({ plan: 'plus', role: 'breeder', state: 'SA', stripeCustomerId: 'cus_synthetic_unchanged' })
  await db.doc('dogs/ruby-emulator').set({ currentOwnerId: uid, tenantId: uid, name: 'Ruby demo', passportId: 'QA-ONLY' })
  const token = await authAdmin.createCustomToken(uid)
  const signed = await signInWithCustomToken(auth, token)
  assert.equal(signed.user.uid, uid, 'phone account UID must be unchanged')
  assert.equal(signed.user.email, null, 'existing account begins with no email')
  assert.equal(signed.user.providerData.some(p => p.providerId === 'password'), false)
  const linked = await linkWithCredential(signed.user, EmailAuthProvider.credential(email, password))
  assert.equal(linked.user.uid, uid, 'credential link must preserve the original UID')
  assert.equal(linked.user.email, email)
  await signOut(auth)
  const returned = await signInWithEmailAndPassword(auth, email, password)
  assert.equal(returned.user.uid, uid, 'email sign-in must return to the same original UID')
  assert.equal((await db.doc('dogs/ruby-emulator').get()).data()?.currentOwnerId, uid, 'dog owner must be unchanged')
  const profile = (await db.doc('users/' + uid).get()).data()
  assert.equal(profile?.plan, 'plus', 'synthetic Plus marker must remain')
  assert.equal(profile?.stripeCustomerId, 'cus_synthetic_unchanged', 'synthetic billing reference must remain')
  assert.equal((await authAdmin.listUsers(10)).users.length, 1, 'no second user should be created')
  console.log('PASS: phone-credential-like session → same UID email/password → preserved Ruby/Plus; no real SMS/email/payment')
} finally {
  await signOut(auth).catch(() => {})
  await deleteApp(client)
  await deleteAdminApp(adminApp)
}
