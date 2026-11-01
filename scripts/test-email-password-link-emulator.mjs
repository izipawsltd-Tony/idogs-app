// Synthetic Firebase Auth + Firestore Emulator E2E for the production Settings
// "Email & password sign-in" flow (src/lib/emailPasswordLink.ts +
// /verify-email). No SMS, email, Stripe or real cloud.
//
// Proves, on the SAME Firebase UID:
//  1. SMS-only customer → verifyBeforeUpdateEmail → link applied → email set
//     and verified → updatePassword → can sign in with email/password; phone
//     sign-in kept; profile/Plus/Stripe refs, dogs, documents, QR flag unchanged.
//  2. SMS customer who already has a verified email → password added only.
//  3. Email owned by ANOTHER account → never attached; both accounts unchanged.
//  4. Before the verification link is opened the address is NOT on the account
//     (no unverified squatting) and no password sign-in exists for it.
//  5. No extra Firebase users are ever created.
import assert from 'node:assert/strict'
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminDb } from 'firebase-admin/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, connectAuthEmulator, signInWithCustomToken, signOut, signInWithEmailAndPassword,
  verifyBeforeUpdateEmail, applyActionCode, reload, updatePassword,
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
async function latestOob(email) {
  const res = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/oobCodes`)
  const { oobCodes = [] } = await res.json()
  return oobCodes.filter(c => (c.email || '').toLowerCase() === email.toLowerCase()).pop()
}
const passwordSignInFails = email => signInWithEmailAndPassword(auth, email, PASSWORD).then(() => false, () => true)

try {
  // Case 1 + 4: SMS-only customer adds email via verification, then a password.
  await seed('sms-only', '+61400000981')
  const before1 = await snapshot('sms-only')
  const u1 = await signInAs('sms-only')
  assert.equal(u1.email, null)
  await verifyBeforeUpdateEmail(u1, 'sms-only@example.invalid')
  assert.equal((await authAdmin.getUser('sms-only')).email, undefined, 'email NOT attached before the link is opened')
  await signOut(auth)
  assert.ok(await passwordSignInFails('sms-only@example.invalid'), 'no password sign-in exists before verification')
  const oob = await latestOob('sms-only@example.invalid')
  assert.ok(oob?.oobCode, 'verification link issued')
  await applyActionCode(auth, oob.oobCode)
  const rec1 = await authAdmin.getUser('sms-only')
  assert.equal(rec1.email, 'sms-only@example.invalid'); assert.equal(rec1.emailVerified, true, 'email verified by the link')
  const u1b = await signInAs('sms-only')
  await reload(u1b)
  assert.equal(u1b.emailVerified, true)
  await updatePassword(u1b, PASSWORD)
  await signOut(auth)
  const back1 = await signInWithEmailAndPassword(auth, 'sms-only@example.invalid', PASSWORD)
  assert.equal(back1.user.uid, 'sms-only', 'email/password sign-in returns the ORIGINAL UID')
  const providers1 = (await authAdmin.getUser('sms-only')).providerData.map(p => p.providerId).sort()
  assert.deepEqual(providers1, ['password', 'phone'], 'phone sign-in kept, password added')
  assert.equal(await snapshot('sms-only'), before1, 'profile/Plus/Stripe refs, dogs, documents, QR flag unchanged')

  // Case 2: SMS customer who already verified an email → password only.
  await seed('sms-verified', '+61400000982', { email: 'verified@example.invalid', emailVerified: true })
  const before2 = await snapshot('sms-verified')
  const u2 = await signInAs('sms-verified')
  await updatePassword(u2, PASSWORD)
  await signOut(auth)
  const back2 = await signInWithEmailAndPassword(auth, 'verified@example.invalid', PASSWORD)
  assert.equal(back2.user.uid, 'sms-verified'); assert.equal(back2.user.emailVerified, true, 'verification kept')
  assert.equal(await snapshot('sms-verified'), before2)

  // Case 3: email owned by ANOTHER account → never attached.
  await seed('sms-collide', '+61400000983')
  const before3 = await snapshot('sms-collide')
  const u3 = await signInAs('sms-collide')
  let rejectedAtSend = false
  try { await verifyBeforeUpdateEmail(u3, 'sms-only@example.invalid') } catch (e) {
    rejectedAtSend = /email-already-in-use|email-exists/i.test(String(e?.code || e?.message)); assert.ok(rejectedAtSend, String(e))
  }
  if (!rejectedAtSend) {
    const oob3 = (await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/oobCodes`)).json()).oobCodes
      .filter(c => c.requestType === 'VERIFY_AND_CHANGE_EMAIL' && (c.email || '').toLowerCase() === 'sms-only@example.invalid').pop()
    if (oob3) await applyActionCode(auth, oob3.oobCode).catch(() => {})
  }
  assert.equal((await authAdmin.getUser('sms-collide')).email, undefined, 'colliding account did not take the address')
  assert.equal(await snapshot('sms-collide'), before3)
  await signOut(auth)
  assert.equal((await signInWithEmailAndPassword(auth, 'sms-only@example.invalid', PASSWORD)).user.uid, 'sms-only', 'email still signs in to its original owner')
  assert.equal(await snapshot('sms-only'), before1, 'owner of the email unchanged')

  assert.equal((await authAdmin.listUsers(20)).users.length, 3, 'no extra users created')
  console.log('PASS: verified-email + password on the same UID; dogs, documents, QR, Plus/Stripe refs unchanged; no unverified attach; collisions never attached; no extra users; no real SMS/email/payment')
} finally {
  await signOut(auth).catch(() => {})
  await deleteApp(client)
  await deleteAdminApp(adminApp)
}
