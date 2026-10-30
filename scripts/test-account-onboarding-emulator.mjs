import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeApp as clientApp, deleteApp as deleteClient } from 'firebase/app'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { accountReadiness, makeOnboardingHandler, passwordVerifier, verifyAccountToken } from '../api/_lib/account-onboarding.js'
import { createPuppyUpdatesHandler } from '../api/_lib/puppy-updates-handler.js'

const require = createRequire(import.meta.url), authRequire = createRequire(require.resolve('firebase/auth'))
const sdk = await import(new URL('../esm2017/index.js', pathToFileURL(authRequire.resolve('@firebase/auth'))).href)
const projectId = 'demo-idogs-account-onboarding'
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9399' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:9380') throw new Error('Isolated onboarding demo only')
const env = { ...process.env, IDOGS_ACCOUNT_ONBOARDING_GATE: '1' }
const authOrigin = 'http://127.0.0.1:9399'
const password = 'Onboarding-emulator-only-123!', email = 'onboarding@example.invalid'
const data = { firstName: 'Existing OTP customer', role: 'breeder', stripeCustomerId: 'cus_existing_fake', plan: 'plus', subscriptionStatus: 'active' }
let app, auth, db, web, session, user, rules, server, origin
async function call(method = 'GET', body, token) {
  const response = await fetch(origin, { method, headers: { Authorization: `Bearer ${token || await session.currentUser.getIdToken(true)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json() }
}
async function phoneSession(phone) {
  const r = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({phoneNumber:phone}) })
  const { sessionInfo } = await r.json()
  const codes = await (await fetch(`${authOrigin}/emulator/v1/projects/${projectId}/verificationCodes`)).json()
  const code = codes.verificationCodes.find(c=>c.sessionInfo===sessionInfo).code
  return (await sdk.signInWithCredential(session, sdk.PhoneAuthProvider.credential(sessionInfo, code))).user
}
before(async () => {
  app = initializeApp({ projectId }, 'onboarding-admin'); auth = getAuth(app); db = getFirestore(app)
  await auth.createUser({ uid: 'otp-existing', phoneNumber: '+61400000501' })
  await auth.createUser({ uid: 'other-existing', email: 'other@example.invalid', emailVerified: true, password })
  await db.doc('users/otp-existing').set(data)
  await db.doc('dogs/owned-existing').set({ tenantId:'otp-existing', currentOwnerId:'otp-existing', name:'Existing dog', status:'active', passportId:'ONBOARDING-DEMO', dob:'2026-01-01' })
  web = clientApp({apiKey:'emulator',projectId},'onboarding-client'); session=sdk.getAuth(web); sdk.connectAuthEmulator(session,authOrigin,{disableWarnings:true})
  user = await phoneSession('+61400000501')
  rules = await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:9380,rules:readFileSync(new URL('../qa/onboarding.firestore.rules.local',import.meta.url),'utf8')}})
  const handler = makeOnboardingHandler({auth,db,env,verifyPassword:passwordVerifier({apiKey:'emulator',env})})
  server=createServer(async(req,res)=>{res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res};let text='';for await(const chunk of req)text+=chunk;req.body=text?JSON.parse(text):undefined;await handler(req,res)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
})
after(async()=>{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await rules?.cleanup();if(web)await deleteClient(web);if(db)await db.terminate();if(app)await deleteApp(app)})
test('existing OTP signs into the same UID and is blocked from management before setup',async()=>{
  assert.equal(user.uid,'otp-existing');assert.equal((await call()).body.ready,false)
  await assert.rejects(verifyAccountToken(await user.getIdToken(),auth,db,env),e=>e.code==='account/setup-required')
  const client=rules.authenticatedContext(user.uid,{firebase:{sign_in_provider:'phone'},email_verified:false}).firestore()
  await assertSucceeds(getDoc(doc(client,'users',user.uid)))
  await assertFails(getDoc(doc(client,'dogs','owned-existing')))
  await assertFails(updateDoc(doc(client,'users',user.uid),{firstName:'Bypass'}))
  await assertFails(setDoc(doc(client,'accountReadiness',user.uid),{uid:user.uid,email,version:1}))
})
test('cannot complete by supplying another email, an unverified email, or client-ready flag',async()=>{
  await assert.rejects(sdk.linkWithCredential(user,sdk.EmailAuthProvider.credential('other@example.invalid',password)))
  assert.equal(user.uid,'otp-existing');assert.equal(user.email,null);assert.equal((await auth.listUsers()).users.length,2)
  assert.equal((await call('POST',{password,email:'other@example.invalid'})).status,400)
  assert.equal((await call('POST',{password,ready:true})).status,400)
  assert.equal((await call('POST',{password})).status,403)
  assert.equal((await db.doc(`accountReadiness/${user.uid}`).get()).exists,false)
})
test('verifies an email on the phone UID and still requires a real working password',async()=>{
  await sdk.linkWithCredential(user,sdk.EmailAuthProvider.credential(email,password))
  await sdk.sendEmailVerification(user)
  const inbox=await(await fetch(`${authOrigin}/emulator/v1/projects/${projectId}/oobCodes`)).json()
  const message=inbox.oobCodes.findLast(c=>c.email===email||c.newEmail===email)
  assert.ok(message);await sdk.applyActionCode(session,message.oobCode);await sdk.reload(user)
  assert.equal(user.uid,'otp-existing');assert.equal(user.email,email);assert.equal(user.emailVerified,true)
  assert.equal((await call()).body.ready,false)
  assert.equal((await call('POST',{password:'wrong-password'})).status,403)
  assert.equal((await db.doc(`accountReadiness/${user.uid}`).get()).exists,false)
  const {uid:ignored,...claims}=await auth.verifyIdToken(await user.getIdToken(true))
  const client=rules.authenticatedContext(user.uid,claims).firestore()
  await assertSucceeds(updateDoc(doc(client,'users',user.uid),{email}))
  await assertFails(updateDoc(doc(client,'users',user.uid),{firstName:'Not ready'}))
})
test('adds a password without creating/switching UID or changing dogs/subscription',async()=>{
  if(user.providerData.some(p=>p.providerId==='password')) {
    // Email-link-only identities can have this provider without a password.
    // Prove mailbox possession through Firebase's reset flow instead of
    // silently overwriting an existing password after phone authentication.
    await sdk.sendPasswordResetEmail(session,email)
    const inbox=await(await fetch(`${authOrigin}/emulator/v1/projects/${projectId}/oobCodes`)).json()
    const message=inbox.oobCodes.findLast(c=>c.email===email&&c.requestType==='PASSWORD_RESET')
    await sdk.confirmPasswordReset(session,message.oobCode,password)
    await sdk.signInWithEmailAndPassword(session,email,password);user=session.currentUser
  } else await sdk.linkWithCredential(user,sdk.EmailAuthProvider.credential(email,password))
  await sdk.reauthenticateWithCredential(user,sdk.EmailAuthProvider.credential(email,password))
  assert.equal((await call('POST',{password:'Definitely-wrong-password'})).status,403)
  assert.equal((await db.doc(`accountReadiness/${user.uid}`).get()).exists,false)
  const result=await call('POST',{password})
  assert.equal(result.status,200);assert.equal(result.body.ready,true);assert.equal(session.currentUser.uid,'otp-existing')
  assert.deepEqual((await db.doc('users/otp-existing').get()).data(),{...data,email})
  assert.equal((await db.doc('dogs/owned-existing').get()).data().currentOwnerId,'otp-existing')
  assert.equal((await auth.listUsers()).users.length,2)
  assert.equal((await verifyAccountToken(await user.getIdToken(true),auth,db,env)).uid,user.uid)
})
test('resumes after sign-out/reload through email/password, and opens only own data under prototype rules',async()=>{
  await sdk.signOut(session);await sdk.signInWithEmailAndPassword(session,email,password);user=session.currentUser
  assert.equal(user.uid,'otp-existing');assert.equal((await call()).body.ready,true)
  const {uid: ignoredUid,...claims}=await auth.verifyIdToken(await user.getIdToken(true))
  const client=rules.authenticatedContext(user.uid,claims).firestore()
  await assertSucceeds(getDoc(doc(client,'dogs','owned-existing')))
  await assertFails(getDoc(doc(client,'users','other-existing')))
  await assertFails(setDoc(doc(client,'accountReadiness',user.uid),{uid:user.uid,email,version:1}))
})
test('email/password provider metadata alone cannot bypass readiness; disabling the gate preserves legacy verification',async()=>{
  const other=await auth.getUser('other-existing')
  assert.equal((await accountReadiness({user:other,db})).ready,false)
  const fakeAuth={verifyIdToken:async()=>({uid:'legacy'})}
  assert.equal((await verifyAccountToken('fake',fakeAuth,undefined,{IDOGS_ACCOUNT_ONBOARDING_GATE:'0'})).uid,'legacy')
  await assert.rejects(verifyAccountToken('fake',fakeAuth,db,{IDOGS_ACCOUNT_ONBOARDING_GATE:'1',FIREBASE_PROJECT_ID:'idogs-app'}))
})
test('returning OTP customer must confirm the primary password even after earlier setup; public QR remains public',async()=>{
  const phoneUser=await phoneSession('+61400000501'),token=await phoneUser.getIdToken(true)
  assert.equal((await call('GET',undefined,token)).body.ready,false)
  await assert.rejects(verifyAccountToken(token,auth,db,env),e=>e.code==='account/setup-required')
  assert.equal((await call('POST',{password},token)).status,403)
  const {uid:ignored,...claims}=await auth.verifyIdToken(token)
  await assertFails(getDoc(doc(rules.authenticatedContext(phoneUser.uid,claims).firestore(),'dogs','owned-existing')))
  await db.doc('puppyProfiles/owned-existing').set({ownerId:phoneUser.uid,publicEnabled:true})
  for(const audience of ['public','internal'])await db.doc(`puppyProfiles/owned-existing/updates/${audience}`).set({authorUid:phoneUser.uid,sourceDogId:'owned-existing',audience,text:audience==='public'?'Public story':'Private note',date:'2026-10-31',createdAt:'2026-10-31',media:[]})
  const handler=createPuppyUpdatesHandler({db,verifyToken:t=>verifyAccountToken(t,auth,db,env),sign:async()=>[]})
  const response={setHeader(){},status(){return this},json(data){this.body=data;return this}}
  await handler({method:'GET',query:{action:'view',passportId:'ONBOARDING-DEMO'},headers:{authorization:`Bearer ${token}`},socket:{remoteAddress:'127.0.0.1'}},response)
  assert.equal(response.body.role,'public');assert.deepEqual(response.body.updates.map(e=>e.text),['Public story'])
  await handler({method:'POST',body:{action:'view',passportId:'ONBOARDING-DEMO'},headers:{authorization:`Bearer ${token}`},socket:{remoteAddress:'127.0.0.1'}},response)
  assert.equal(response.body.role,'public');assert.deepEqual(response.body.updates.map(e=>e.text),['Public story'])
  await sdk.reauthenticateWithCredential(phoneUser,sdk.EmailAuthProvider.credential(email,password));user=session.currentUser
  assert.equal((await call('POST',{password})).status,200)
})
test('removing a phone does not bypass setup; current email changes and disabled state invalidate access',async()=>{
  await db.doc(`accountReadiness/${user.uid}`).delete();await auth.updateUser(user.uid,{phoneNumber:null})
  assert.equal((await accountReadiness({user:await auth.getUser(user.uid),db})).ready,false)
  await call('POST',{password})
  await auth.updateUser(user.uid,{email:'changed@example.invalid',emailVerified:false})
  assert.equal((await accountReadiness({user:await auth.getUser(user.uid),db})).ready,false)
  await auth.updateUser(user.uid,{disabled:true})
  await assert.rejects(accountReadiness({user:await auth.getUser(user.uid),db}),e=>e.code==='account/disabled')
})
