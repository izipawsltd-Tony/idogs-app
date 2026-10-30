import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeApp as clientApp, deleteApp as deleteClient } from 'firebase/app'

// Node's Auth entry replaces phone APIs with unsupported stubs. Exercise the
// installed browser implementation used by Vite, without a browser/real SMS.
const require = createRequire(import.meta.url)
const authRequire = createRequire(require.resolve('firebase/auth'))
const browserAuth = new URL('../esm2017/index.js', pathToFileURL(authRequire.resolve('@firebase/auth')))
const { connectAuthEmulator, getAuth: clientAuth, signInWithEmailAndPassword, reauthenticateWithCredential, EmailAuthProvider, PhoneAuthProvider, updatePhoneNumber } = await import(browserAuth.href)

const projectId = 'demo-idogs-account-mobile'
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9299' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:9280') throw new Error('Only the isolated loopback demo emulators are allowed')
const origin = 'http://127.0.0.1:9299'
let admin, web, auth, db, session
const password = 'Emulator-only-password-123!'
const initialPhone = '+61400000001', replacementPhone = '+61400000002'
const data = { firstName: 'Synthetic', role: 'breeder', stripeCustomerId: 'cus_emulator', subscriptionStatus: 'active', plan: 'plus', dogs: ['synthetic-dog'] }
async function challenge(phone) {
  const r = await fetch(`${origin}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone }) })
  assert.equal(r.status, 200)
  const { sessionInfo } = await r.json()
  const codes = await (await fetch(`${origin}/emulator/v1/projects/${projectId}/verificationCodes`)).json()
  const record = codes.verificationCodes.find(c => c.sessionInfo === sessionInfo)
  assert.ok(record)
  return PhoneAuthProvider.credential(sessionInfo, record.code)
}
before(async () => {
  admin = initializeApp({ projectId }, 'account-mobile-admin')
  auth = getAuth(admin); db = getFirestore(admin)
  await auth.createUser({ uid: 'primary', email: 'primary@example.invalid', emailVerified: true, password, phoneNumber: initialPhone })
  await auth.createUser({ uid: 'other', email: 'other@example.invalid', emailVerified: true, password, phoneNumber: '+61400000003' })
  await db.doc('users/primary').set(data)
  await db.doc('dogs/synthetic-dog').set({ ownerId: 'primary', name: 'Synthetic dog' })
  web = clientApp({ apiKey: 'emulator', projectId }, 'account-mobile-client')
  session = clientAuth(web); connectAuthEmulator(session, origin, { disableWarnings: true })
  await signInWithEmailAndPassword(session, 'primary@example.invalid', password)
})
after(async () => { if (web) await deleteClient(web); if (db) await db.terminate(); if (admin) await deleteApp(admin) })
test('wrong email password is rejected before replacement', async () => {
  await assert.rejects(reauthenticateWithCredential(session.currentUser, EmailAuthProvider.credential('primary@example.invalid', 'wrong-password')))
  assert.equal((await auth.getUser('primary')).phoneNumber, initialPhone)
})
test('reauthentication + new OTP replaces only the phone on the same UID and preserves records/subscription', async () => {
  const result = await reauthenticateWithCredential(session.currentUser, EmailAuthProvider.credential('primary@example.invalid', password))
  assert.equal(result.user.uid, 'primary')
  const credential = await challenge(replacementPhone)
  assert.equal((await auth.getUser('primary')).phoneNumber, initialPhone)
  await updatePhoneNumber(session.currentUser, credential)
  assert.equal(session.currentUser.uid, 'primary')
  assert.equal((await auth.getUserByPhoneNumber(replacementPhone)).uid, 'primary')
  await assert.rejects(auth.getUserByPhoneNumber(initialPhone), e => e.code === 'auth/user-not-found')
  assert.deepEqual((await db.doc('users/primary').get()).data(), data)
  assert.equal((await db.doc('dogs/synthetic-dog').get()).data().ownerId, 'primary')
  assert.equal((await auth.listUsers()).users.length, 2)
})
test('a number belonging to another account is rejected without removing the current number', async () => {
  await assert.rejects(updatePhoneNumber(session.currentUser, await challenge('+61400000003')), e => /credential-already-in-use|account-exists-with-different-credential/.test(e.code))
  assert.equal((await auth.getUser('primary')).phoneNumber, replacementPhone)
  assert.equal((await auth.getUser('other')).phoneNumber, '+61400000003')
  assert.equal((await auth.listUsers()).users.length, 2)
})
test('an incorrect OTP does not replace the existing number', async () => {
  const credential = await challenge('+61400000004')
  const wrong = credential.smsCode === '000000' ? '111111' : '000000'
  await assert.rejects(updatePhoneNumber(session.currentUser, PhoneAuthProvider.credential(credential.verificationId, wrong)))
  assert.equal((await auth.getUser('primary')).phoneNumber, replacementPhone)
  assert.equal((await auth.listUsers()).users.length, 2)
})
