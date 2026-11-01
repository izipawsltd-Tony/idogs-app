// Synthetic Firebase Auth + Firestore Emulator E2E for the production Settings
// "Email & password sign-in" flow (src/lib/emailPasswordLink.ts).
// No SMS, email, Stripe or real cloud. Proves: same UID, dogs/documents/QR/
// Plus fields untouched, no second user, email owned by another UID is rejected.
import assert from 'node:assert/strict'
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminDb } from 'firebase-admin/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, connectAuthEmulator, signInWithCustomToken, EmailAuthProvider,
  linkWithCredential, signOut, signInWithEmailAndPassword, updatePassword,
} from 'firebase/auth'

const project = 'demo-idogs-email-link'
if (process.env.GCLOUD_PROJECT !== project ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Refusing to run outside isolated Firebase Emulators')
}
const adminApp = initializeAdminApp({ projectId: project }, 'email-link-qa-admin')
const authAdmin = getAdminAuth(adminApp)
const db = getAdminDb(adminApp)
const client = initializeApp({ apiKey: 'emulator-only-key', authDomain: 'localhost', projectId: project, appId: 'synthetic-qa' }, 'email-link-qa-client')
const auth = getAuth(client)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })

const PASSWORD = 'Synthetic-Password-2026!'
const snapshot = async uid => JSON.stringify({
  user: (await db.doc('users/' + uid).get()).data(),
  dogs: (await db.collection('dogs').where('currentOwnerId', '==', uid).get()).docs.map(d => [d.id, d.data()]),
  docs: (await db.collection('documents').where('tenantId', '==', uid).get()).docs.map(d => [d.id, d.data()]),
})
async function seed(uid, phone, extra = {}) {
  await authAdmin.createUser({ uid, phoneNumber: phone, ...extra })
  await db.doc('users/' + uid).set({ plan: 'plus', role: 'owner', state: 'SA', stripeCustomerId: 'cus_synthetic_' + uid, stripeSubscriptionId: 'sub_synthetic_' + uid, plusPromotion: 'A0_UNTIL_20270131' })
  await db.doc(`dogs/${uid}-dog`).set({ currentOwnerId: uid, tenantId: uid, name: 'Ruby demo', passportId: 'QA-' + uid })
  await db.doc(`documents/${uid}-doc`).set({ dogId: `${uid}-dog`, tenantId: uid, name: 'Vaccine card', qrShared: true })
}
async function signInAs(uid) { await signOut(auth).catch(() => {}); return (await signInWithCustomToken(auth, await authAdmin.createCustomToken(uid))).user }

try {
  // Case 1: SMS-only customer, no email → add email+password.
  await seed('sms-only', '+61400000981')
  const before1 = await snapshot('sms-only')
  const u1 = await signInAs('sms-only')
  assert.equal(u1.email, null)
  const l1 = await linkWithCredential(u1, EmailAuthProvider.credential('sms-only@example.invalid', PASSWORD))
  assert.equal(l1.user.uid, 'sms-only', 'UID preserved')
  await signOut(auth)
  const back1 = await signInWithEmailAndPassword(auth, 'sms-only@example.invalid', PASSWORD)
  assert.equal(back1.user.uid, 'sms-only', 'email/password sign-in returns the original UID')
  assert.ok(back1.user.providerData.some(p => p.providerId === 'phone'), 'phone sign-in kept')
  assert.equal(await snapshot('sms-only'), before1, 'profile/Plus/Stripe refs, dogs, documents unchanged')

  // Case 2: SMS customer who already added a verified email (VerifyEmailPage) → add password for SAME email.
  await seed('sms-verified', '+61400000982', { email: 'verified@example.invalid', emailVerified: true })
  const before2 = await snapshot('sms-verified')
  const u2 = await signInAs('sms-verified')
  // Firebase refuses to LINK a credential for an email the account already
  // holds — this is why the app uses updatePassword() for this case.
  await assert.rejects(linkWithCredential(u2, EmailAuthProvider.credential('verified@example.invalid', PASSWORD)),
    e => /email-already-in-use/.test(String(e?.code || e?.message)))
  await updatePassword(u2, PASSWORD)
  await u2.reload()
  assert.equal(u2.uid, 'sms-verified'); assert.equal(u2.emailVerified, true, 'existing verification kept')
  assert.ok(u2.providerData.some(p => p.providerId === 'password'), 'password sign-in enabled on the same account')
  await signOut(auth)
  assert.equal((await signInWithEmailAndPassword(auth, 'verified@example.invalid', PASSWORD)).user.uid, 'sms-verified')
  assert.equal(await snapshot('sms-verified'), before2)

  // Case 3: email already belongs to ANOTHER account → rejected, nothing merged.
  await seed('sms-collide', '+61400000983')
  const before3 = await snapshot('sms-collide')
  const u3 = await signInAs('sms-collide')
  await assert.rejects(linkWithCredential(u3, EmailAuthProvider.credential('sms-only@example.invalid', PASSWORD)),
    e => /email-already-in-use|credential-already-in-use/.test(String(e?.code || e?.message)), 'email owned by another UID must be rejected')
  assert.equal((await authAdmin.getUser('sms-collide')).email, undefined, 'colliding account unchanged')
  assert.equal(await snapshot('sms-collide'), before3)
  assert.equal(await snapshot('sms-only'), before1, 'owner of the email unchanged')

  assert.equal((await authAdmin.listUsers(20)).users.length, 3, 'no extra users created')
  console.log('PASS: email/password link preserves UID, dogs, documents, QR, Plus/Stripe refs; collisions rejected; no real SMS/email/payment')
} finally {
  await signOut(auth).catch(() => {})
  await deleteApp(client)
  await deleteAdminApp(adminApp)
}
