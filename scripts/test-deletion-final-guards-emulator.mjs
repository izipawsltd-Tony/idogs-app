import { sendScheduledReminderEmail } from '../api/_lib/scheduled-reminder-email.js'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { createHash } from 'node:crypto'
import { createCheckoutHandler } from '../api/_lib/checkout-handler.js'
import { createBillingPortalHandler } from '../api/_lib/billing-handler.js'
import { createSmsAddonCheckoutHandler, createSmsAddonRemoveHandler } from '../api/_lib/sms-checkout-handler.js'
import { createExtraLitterCheckoutHandler } from '../api/_lib/extra-litter-checkout-handler.js'
import { createWebhookHandler } from '../api/_lib/webhook-handler.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'
import { reconcileVerifiedPaidSubscription } from '../api/_lib/billing-reconcile.js'
import { grantExtraLitterCreditFromVerifiedEvent } from '../api/_lib/extra-litter-webhook.js'
import { breederIdentity } from '../api/_lib/breeder-profile.js'
import { dispatchAccountOperation, writeReminderRecord } from '../api/_lib/account-external-operations.js'
import { deliverManualReminder } from '../api/_lib/manual-reminder-delivery.js'
import { sendSmsWithQuota } from '../api/_lib/sms-addon.js'
import { reorderAccountMedia } from '../api/_lib/account-media-writes.js'
import { queueGrantCleanup } from '../api/_lib/media-cleanup.js'
import { buildDeletionInventory } from '../api/_lib/account-deletion-inventory.js'

const projectId = 'demo-idogs-account-deletion', bucketName = `${projectId}.firebasestorage.app`
for (const [key, port] of [['FIRESTORE_EMULATOR_HOST','8080'],['FIREBASE_AUTH_EMULATOR_HOST','9099'],['FIREBASE_STORAGE_EMULATOR_HOST','9199']]) {
  if (process.env.GCLOUD_PROJECT !== projectId || !new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(process.env[key] || '')) throw new Error('emulator_only')
}
process.env.FIREBASE_PROJECT_ID = projectId
process.env.FIREBASE_STORAGE_BUCKET = bucketName
process.env.CRON_SECRET = 'synthetic-final-guards'
let app, db, bucket, cleanupHandler, cronHandler, n = 0
const now = new Date('2026-10-22T10:00:00Z')
before(async () => {
  app = initializeApp({ projectId, storageBucket: bucketName }); db = getFirestore(app); bucket = getStorage(app).bucket(bucketName)
  cleanupHandler = (await import('../api/cleanup-showcase-media-uploads.js')).default
  cronHandler = (await import('../api/send-reminders.js')).default
})
after(async () => { await db?.terminate(); if (app) await deleteApp(app) })
async function fixture() {
  const uid = `qa-final-${++n}`, dogId = `qa-final-dog-${n}`
  const profile = { email: `${uid}@example.invalid`, emailReminders: true, manualReminderEmails: true, plan: 'plus', stripeCustomerId: `cus_${n}`, stripeSubscriptionId: `sub_${n}`, smsAddonStatus: 'active', smsPeriodStart:'2026-10-01T00:00:00Z',smsPeriodEnd:'2026-11-01T00:00:00Z', smsCreditsUsed: 0 }
  await db.doc(`users/${uid}`).set(profile)
  await db.doc(`dogs/${dogId}`).set({ tenantId: uid, currentOwnerId: uid, name: 'Synthetic', status: 'active' })
  const reminderId = `qa-final-reminder-${n}`
  await db.doc(`reminders/${reminderId}`).set({ tenantId: uid, dogId, source: 'manual', type:'custom',status:'pending',title:'Synthetic care',dueDate:'2026-10-22',notifyDaysBefore:0 })
  return { uid, dogId, profile, reminderId, freeze: (state = 'frozen') => db.doc(`accountDeletionFences/${uid}`).set({ state }), subscription: { id: `sub_${n}`, customer:`cus_${n}`,status:'active',metadata:{userId:uid},items:{data:[{price:{id:CHECKOUT_PRICE_IDS.plus_monthly}}]} } }
}
const rows = async (collection, uid) => (await db.collection(collection).where('uid','==',uid).get()).docs.map(d => d.data())
async function call(handler) {
  const res = { code:200,status(c){this.code=c;return this},json(body){this.body=body;return this} }
  await handler({method:'POST',headers:{'x-cron-secret':'synthetic-final-guards'}},res);return res
}
for (const state of ['frozen','completed','malformed']) for (const type of ['checkout.session.completed','customer.subscription.updated','customer.subscription.deleted','invoice.payment_succeeded']) {
  test(`verified ${type} after ${state} cannot recreate profile or change dog`, async () => {
    const f = await fixture();await f.freeze(state);await db.doc(`users/${f.uid}`).delete()
    const dogBefore = (await db.doc(`dogs/${f.dogId}`).get()).data()
    const event = { id:`evt_final_${++n}`,type,created:1792663200,data:{object:type.startsWith('checkout.')?{metadata:{userId:f.uid},subscription:f.subscription.id,customer:f.subscription.customer}:type.startsWith('invoice.')?{subscription:f.subscription.id,customer:f.subscription.customer}:f.subscription} }
    const handler = createWebhookHandler({db,constructEvent:()=>event,getSubscription:async()=>f.subscription})
    assert.equal((await handler('', '')).status,200)
    assert.equal((await handler('', '')).status,200)
    assert.equal((await db.doc(`users/${f.uid}`).get()).exists,false)
    assert.deepEqual((await db.doc(`dogs/${f.dogId}`).get()).data(),dogBefore)
    assert.equal((await rows('accountBillingEvents',f.uid)).length,1)
    assert.equal((await reconcileVerifiedPaidSubscription({db,userId:f.uid,subscription:f.subscription,event})),false)
  })
}
test('healthy paid reconcile works; stale event and frozen account cannot reset quota',async()=>{
  const f=await fixture()
  assert.equal((await reconcileVerifiedPaidSubscription({db,userId:f.uid,subscription:f.subscription,eventCreated:100})).plan,'plus')
  await db.doc(`users/${f.uid}`).update({plusScansUsed:4})
  assert.equal(await reconcileVerifiedPaidSubscription({db,userId:f.uid,subscription:f.subscription,eventCreated:99}),false)
  await f.freeze()
  assert.equal(await reconcileVerifiedPaidSubscription({db,userId:f.uid,subscription:f.subscription,eventCreated:101}),false)
  assert.equal((await db.doc(`users/${f.uid}`).get()).data().plusScansUsed,4)
})
test('paid Extra Litter late event produces review receipt, never a new credit',async()=>{
  const f=await fixture(); await f.freeze()
  const breederProfileId=breederIdentity(f.profile,{uid:f.uid,authEmail:f.profile.email}).breederProfileId
  const event={id:`evt_credit_${n}`,type:'checkout.session.completed',data:{object:{id:`cs_final_${n}`,mode:'payment',payment_status:'paid',currency:'aud',amount_total:3900,customer:f.profile.stripeCustomerId,metadata:{userId:f.uid,purchaseType:'extra_litter',breederProfileId}}}}
  assert.equal((await grantExtraLitterCreditFromVerifiedEvent({db,event})).suppressed,true)
  assert.equal((await db.doc(`litterQuotaCredits/cs_final_${n}`).get()).exists,false)
  assert.equal((await rows('accountBillingEvents',f.uid)).length,1)
})
for(const kind of ['billing_checkout','reminder_email','reminder_sms']) test(`${kind} frozen admission never calls provider`,async()=>{
  const f=await fixture();await f.freeze();let calls=0
  await assert.rejects(dispatchAccountOperation({db,uid:f.uid,dogId:f.dogId,kind,invoke:async()=>{calls++}}),/paused/)
  assert.equal(calls,0);assert.equal((await rows('accountExternalOperations',f.uid)).length,0)
})
test('freeze immediately after admission cancels before provider',async()=>{
  const f=await fixture();let transactions=0,calls=0
  const wrapped={collection:(...a)=>db.collection(...a),runTransaction:async cb=>{const value=await db.runTransaction(cb);if(++transactions===1)await f.freeze();return value}}
  await assert.rejects(dispatchAccountOperation({db:wrapped,uid:f.uid,kind:'billing_checkout',invoke:async()=>{calls++}}),/paused/)
  assert.equal(calls,0);assert.equal((await rows('accountExternalOperations',f.uid))[0].state,'cancelled')
})
test('freeze while provider is in flight exposes drain hold; late receipt never recreates profile',async()=>{
  const f=await fixture();let entered,release
  const started=new Promise(r=>entered=r), pending=new Promise(r=>release=r)
  const task=dispatchAccountOperation({db,uid:f.uid,dogId:f.dogId,kind:'reminder_email',invoke:async()=>{entered();await pending;return true}})
  await started;await f.freeze('completed');await db.doc(`users/${f.uid}`).delete()
  assert.ok((await buildDeletionInventory({db,uid:f.uid})).holds.includes('external_operations_unsettled'))
  release();await task
  assert.equal((await db.doc(`users/${f.uid}`).get()).exists,false)
  assert.equal((await rows('accountExternalOperations',f.uid))[0].state,'settled')
})
test('ambiguous provider response is durable and cannot be replayed with the same delivery key',async()=>{
  const f=await fixture(),operationKey=createHash('sha256').update(f.uid).digest('hex');let calls=0
  const args={db,uid:f.uid,dogId:f.dogId,kind:'reminder_email',operationKey,invoke:async()=>{calls++;throw Error('lost response')}}
  await assert.rejects(dispatchAccountOperation(args),/lost response/)
  await assert.rejects(dispatchAccountOperation(args),/already admitted/)
  assert.equal(calls,1);assert.equal((await rows('accountExternalOperations',f.uid))[0].state,'review_required')
  assert.ok((await buildDeletionInventory({db,uid:f.uid})).holds.includes('external_operations_unsettled'))
})
test('late provider receipt cannot recreate removed journal',async()=>{
  const f=await fixture()
  await dispatchAccountOperation({db,uid:f.uid,kind:'billing_checkout',invoke:async()=>{const docs=await db.collection('accountExternalOperations').where('uid','==',f.uid).get();await docs.docs[0].ref.delete();return true}})
  assert.equal((await rows('accountExternalOperations',f.uid)).length,0)
})
test('stale reminder writer cannot mutate after transfer, freeze, or recreate a deleted record',async()=>{
  const f=await fixture(),ref=db.doc(`reminders/${f.reminderId}`)
  const args={db,uid:f.uid,dogId:f.dogId,ref,data:{title:'Changed'},update:true}
  assert.equal(await writeReminderRecord(args),true)
  await db.doc(`dogs/${f.dogId}`).update({currentOwnerId:'another-owner'})
  await assert.rejects(writeReminderRecord(args),/paused/)
  await db.doc(`dogs/${f.dogId}`).update({currentOwnerId:f.uid});await ref.delete()
  assert.equal(await writeReminderRecord(args),false)
  await f.freeze();await assert.rejects(writeReminderRecord({...args,update:false}),/paused/)
  assert.equal((await ref.get()).exists,false)
})
test('manual reminder frozen before claim neither sends nor creates delivery',async()=>{
  const f=await fixture();await f.freeze();let calls=0
  const result=await deliverManualReminder({db,tenantId:f.uid,reminderId:f.reminderId,now,projectId,appUrl:'https://synthetic.invalid',sendEmail:async()=>{calls++;return true}})
  assert.equal(result.sent,false);assert.equal(calls,0)
  assert.equal((await db.collection('reminderEmailDeliveries').where('tenantId','==',f.uid).get()).size,0)
})
test('SMS ambiguous acceptance is charged once and never automatically retried',async()=>{
  const f=await fixture();let calls=0
  const args={db,tenantId:f.uid,dogId:f.dogId,phone:'0412345678',message:'Synthetic',eventType:'custom',sourceRecordId:'synthetic',milestoneKey:'today',idempotencyKey:f.uid,now,sendProvider:async()=>{calls++;throw Error('lost SNS response')}}
  assert.equal((await sendSmsWithQuota(args)).reason,'PROVIDER_REVIEW_REQUIRED')
  assert.equal((await sendSmsWithQuota(args)).reason,'DUPLICATE')
  assert.equal(calls,1);assert.equal((await db.doc(`users/${f.uid}`).get()).data().smsCreditsUsed,1)
  const inventory=await buildDeletionInventory({db,uid:f.uid});assert.ok(inventory.holds.includes('reminder_delivery_unsettled'))
})
test('gallery removals atomically queue exact generations and preserve shared/transferred bytes',async()=>{
  const f=await fixture(),path=`dogs/previous-owner/${f.dogId}/photos/shared.jpg`
  await bucket.file(path).save(Buffer.from('synthetic-shared'))
  const generation=String((await bucket.file(path).getMetadata())[0].generation)
  await db.doc(`dogs/${f.dogId}`).update({photos:[{id:'one',path,generation}]})
  await reorderAccountMedia({db,uid:f.uid,dogId:f.dogId,arrayField:'photos',order:[],bucket:bucketName})
  const tasks=await rows('mediaCleanupTasks',f.uid)
  assert.equal(tasks.length,1);assert.equal(tasks[0].generation,generation);assert.equal(tasks[0].state,'review_required')
  assert.equal((await bucket.file(path).exists())[0],true)
  assert.ok((await buildDeletionInventory({db,uid:f.uid})).holds.includes('media_cleanup_review'))
})
test('expired grant cron queues once, preserves object/replacement and ledger, and does not starve next batch',async()=>{
  const f=await fixture(),path=`dogs/${f.uid}/${f.dogId}/photos/expired.jpg`,grantRef=db.doc(`mediaUploadGrants/final-expired-${n}`)
  await bucket.file(path).save(Buffer.from('replacement'))
  await grantRef.set({uid:f.uid,dogId:f.dogId,path,status:'expired',expiresAt:'2020-01-01T00:00:00Z'})
  const result=await call(cleanupHandler);assert.equal(result.code,200);assert.equal(result.body.cleaned,0)
  assert.equal((await grantRef.get()).data().status,'cleanup_review')
  assert.equal(await queueGrantCleanup({db,grantRef,bucket:bucketName}),false)
  assert.equal((await bucket.file(path).download())[0].toString(),'replacement')
  assert.equal((await rows('mediaCleanupTasks',f.uid)).length,1)
})
test('cleanup request cannot race a confirmed grant into deleting its file',async()=>{
  const f=await fixture(),path=`dogs/${f.uid}/${f.dogId}/photos/confirmed.jpg`,grantRef=db.doc(`mediaUploadGrants/final-confirmed-${n}`)
  await grantRef.set({uid:f.uid,dogId:f.dogId,path,status:'confirmed',expiresAt:'2020-01-01T00:00:00Z'})
  assert.equal(await queueGrantCleanup({db,grantRef,bucket:bucketName}),false)
  assert.equal((await rows('mediaCleanupTasks',f.uid)).length,0)
})
test('actual scheduler refuses an unapproved demo origin before any provider transport',async()=>{
  const f=await fixture();await f.freeze();process.env.APP_URL='https://idogs-app-staging.vercel.app'
  // Earlier fixtures include healthy accounts: opt them out for this isolated
  // scheduler smoke, without invoking transport or changing production data.
  const users=await db.collection('users').get()
  for(const d of users.docs)if(d.id!==f.uid)await d.ref.update({emailReminders:false})
  const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('transport forbidden')}
  try{const result=await call(cronHandler);assert.equal(result.code,500);assert.equal(calls,0)}finally{globalThis.fetch=oldFetch}
})

for (const [name, factory] of [['checkout',createCheckoutHandler],['portal',createBillingPortalHandler],['sms-add',createSmsAddonCheckoutHandler],['sms-remove',createSmsAddonRemoveHandler],['extra-litter',createExtraLitterCheckoutHandler]]) test(`${name} factory uses fenced dispatch and never calls Stripe for a frozen account`,async()=>{
  const f=await fixture();await f.freeze();let calls=0
  process.env.STRIPE_GST_TAX_RATE_ID='txr_SyntheticQA'
  const provider=async()=>{calls++;return{id:'synthetic',url:'https://synthetic.invalid'}}
  const sub={...f.subscription,livemode:true,items:{data:[...f.subscription.items.data,...(name==='sms-remove'?[{id:'si_synthetic',price:{id:'price_synthetic_sms'}}]:[])]}}
  const handler=factory({verifyIdToken:async()=>({uid:f.uid,email:f.profile.email}),getProfile:async()=>({...f.profile,subscriptionStatus:'active'}),getAppUrl:()=> 'https://synthetic.invalid',getPriceId:()=> 'price_synthetic_sms',isEnabled:()=>true,getPurchaseEligibility:async()=>({includedExhausted:true,availableCredits:0}),retrieveSubscription:async()=>sub,createSession:provider,createPortalSession:provider,updateSubscription:provider,
    dispatch:(uid,invoke)=>dispatchAccountOperation({db,uid,kind:'billing_mutation',invoke})})
  const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}}
  await handler({method:'POST',headers:{authorization:'Bearer synthetic'},body:{...(name==='checkout'?{plan:'plus_monthly'}:name==='extra-litter'?{requestId:'synthetic_request_1234'}:{})}},res)
  assert.equal(res.code,409,JSON.stringify(res.body));assert.equal(res.body.reason,'ACCOUNT_WRITES_FROZEN');assert.equal(calls,0)
})
test('manual opt-out committed after claim prevents dispatch despite the old payload',async()=>{
  const f=await fixture();let transactions=0,calls=0
  const wrapped={collection:(...a)=>db.collection(...a),runTransaction:async cb=>{const result=await db.runTransaction(cb);if(++transactions===1)await db.doc(`users/${f.uid}`).update({manualReminderEmails:false});return result}}
  const result=await deliverManualReminder({db:wrapped,tenantId:f.uid,reminderId:f.reminderId,now,projectId,appUrl:'https://synthetic.invalid',sendEmail:async()=>{calls++;return true}})
  assert.equal(result.sent,false);assert.equal(calls,0)
})

function scheduled(f, sendEmail, at=now, frequency='once') {
  return { db, projectId, uid:f.uid, dogId:f.dogId, recipientEmail:f.profile.email, eventType:'vaccination', sourceId:'synthetic-care', milestone:'2026-10-25', now:at, frequency, sendEmail }
}
for (const change of ['category', 'recipient']) test(`scheduled ${change} change after admission cancels provider dispatch`, async () => {
  const f = await fixture(); let transactions = 0, calls = 0
  const wrapped = { collection: (...a) => db.collection(...a), runTransaction: async cb => {
    const result = await db.runTransaction(cb)
    if (++transactions === 1) await db.doc(`users/${f.uid}`).update(change === 'category'
      ? { careEmailTypes: { vaccination: false } } : { email: 'changed@example.invalid' })
    return result
  } }
  await assert.rejects(sendScheduledReminderEmail({ ...scheduled(f, async () => { calls++; return true }), db: wrapped }), /preferences or recipient changed/)
  assert.equal(calls, 0)
  assert.equal((await rows('accountExternalOperations', f.uid))[0].state, 'cancelled')
})
test('concurrent scheduled care claims use one durable event admission',async()=>{
  const f=await fixture();let calls=0
  const args=scheduled(f,async()=>{calls++;return true})
  const results=await Promise.allSettled([sendScheduledReminderEmail(args),sendScheduledReminderEmail(args)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1)
  assert.equal((await rows('accountExternalOperations',f.uid)).length,1)
})
test('lost scheduled provider response cannot replay once-only care tomorrow',async()=>{
  const f=await fixture();let calls=0
  const sendEmail=async()=>{calls++;throw Error('synthetic lost response')}
  await assert.rejects(sendScheduledReminderEmail(scheduled(f,sendEmail)),/lost response/)
  await assert.rejects(sendScheduledReminderEmail(scheduled(f,sendEmail,new Date('2026-10-23T10:00:00Z'))),/already admitted/)
  assert.equal(calls,1);assert.equal((await rows('accountExternalOperations',f.uid))[0].state,'review_required')
})
test('scheduled daily care has distinct day admissions and frozen next-day claims still fail closed',async()=>{
  const f=await fixture();let calls=0
  const sendEmail=async()=>{calls++;return true}
  assert.equal((await sendScheduledReminderEmail(scheduled(f,sendEmail,now,'daily'))).sent,true)
  assert.equal((await sendScheduledReminderEmail(scheduled(f,sendEmail,new Date('2026-10-23T10:00:00Z'),'daily'))).sent,true)
  await f.freeze()
  await assert.rejects(sendScheduledReminderEmail(scheduled(f,sendEmail,new Date('2026-10-24T10:00:00Z'),'daily')),/paused/)
  assert.equal(calls,2);assert.equal((await rows('accountExternalOperations',f.uid)).length,2)
})
