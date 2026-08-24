import assert from 'node:assert/strict'
import {
  countSmsSegments,
  normalizeAustralianMobile,
  reserveSmsDelivery,
  markSmsDeliveryFailed,
  sendSmsWithQuota,
  SMS_MONTHLY_CREDITS,
} from '../api/_lib/sms-addon.js'
import { createSmsAddonCheckoutHandler } from '../api/_lib/sms-checkout-handler.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log('PASS', name)
}

class Snap {
  constructor(data) { this._data = data }
  get exists() { return this._data !== undefined }
  data() { return this._data }
}
class Ref {
  constructor(db, col, id) { this.db=db; this.col=col; this.id=id }
}
class Collection {
  constructor(db, name) { this.db=db; this.name=name }
  doc(id) { return new Ref(this.db, this.name, id) }
}
class FakeDb {
  constructor(seed={}) { this.store=structuredClone(seed) }
  collection(name) { return new Collection(this,name) }
  async runTransaction(fn) {
    const staged=[]
    const tx={
      get: async ref => new Snap(structuredClone(this.store[ref.col]?.[ref.id])),
      set: (ref,data,opts={}) => staged.push(['set',ref,structuredClone(data),opts]),
      update: (ref,data) => staged.push(['set',ref,structuredClone(data),{merge:true}]),
    }
    const result=await fn(tx)
    for(const [,ref,data,opts] of staged){
      this.store[ref.col] ||= {}
      this.store[ref.col][ref.id] = opts.merge
        ? { ...(this.store[ref.col][ref.id]||{}), ...data }
        : data
    }
    return result
  }
}
function activeProfile(used=0) {
  return {
    smsAddonStatus:'active',
    smsCreditsLimit:20,
    smsCreditsUsed:used,
    smsPeriodStart:'2026-08-01T00:00:00.000Z',
    smsPeriodEnd:'2026-09-01T00:00:00.000Z',
  }
}
const NOW = new Date('2026-08-24T12:00:00.000Z')

await check('GSM-7 short message uses one segment', () => {
  assert.equal(countSmsSegments('iDogs: Bella vaccination due 15 Sep 2026.'),1)
})
await check('GSM-7 concatenated message counts segments', () => {
  assert.equal(countSmsSegments('A'.repeat(161)),2)
})
await check('Unicode message uses UCS-2 limits', () => {
  assert.equal(countSmsSegments('🐾'.repeat(71)),2)
})
await check('Australian local mobile normalizes to E.164', () => {
  assert.equal(normalizeAustralianMobile('0412 345 678'),'+61412345678')
})
await check('Australian E.164 mobile remains unchanged', () => {
  assert.equal(normalizeAustralianMobile('+61412345678'),'+61412345678')
})
await check('non-Australian/mobile-invalid number is rejected', () => {
  assert.equal(normalizeAustralianMobile('+15551234567'),null)
})
await check('monthly allowance is locked at 20 credits', () => {
  assert.equal(SMS_MONTHLY_CREDITS,20)
})
await check('active entitlement reserves quota atomically', async () => {
  const db=new FakeDb({users:{u1:activeProfile(0)}})
  const r=await reserveSmsDelivery({
    db,tenantId:'u1',dogId:'d1',eventType:'vaccination',sourceRecordId:'v1',
    milestoneKey:'2026-08-25',idempotencyKey:'vacc:u1:d1:v1:2026-08-25',
    segmentCount:1,now:NOW,
  })
  assert.equal(r.allowed,true)
  assert.equal(db.store.users.u1.smsCreditsUsed,1)
})
await check('same idempotency key cannot reserve twice', async () => {
  const db=new FakeDb({users:{u1:activeProfile(0)}})
  const args={
    db,tenantId:'u1',dogId:'d1',eventType:'worming',sourceRecordId:'w1',
    milestoneKey:'2026-08-25',idempotencyKey:'worm:u1:d1:w1:2026-08-25',
    segmentCount:1,now:NOW,
  }
  assert.equal((await reserveSmsDelivery(args)).allowed,true)
  const second=await reserveSmsDelivery(args)
  assert.equal(second.allowed,false)
  assert.equal(second.reason,'DUPLICATE')
  assert.equal(db.store.users.u1.smsCreditsUsed,1)
})
await check('19 of 20 plus one succeeds', async () => {
  const db=new FakeDb({users:{u1:activeProfile(19)}})
  const r=await reserveSmsDelivery({
    db,tenantId:'u1',eventType:'heat_cycle',sourceRecordId:'h1',milestoneKey:'m1',
    idempotencyKey:'h1',segmentCount:1,now:NOW,
  })
  assert.equal(r.allowed,true)
  assert.equal(db.store.users.u1.smsCreditsUsed,20)
})
await check('20 of 20 blocks next SMS', async () => {
  const db=new FakeDb({users:{u1:activeProfile(20)}})
  const r=await reserveSmsDelivery({
    db,tenantId:'u1',eventType:'heat_cycle',sourceRecordId:'h2',milestoneKey:'m2',
    idempotencyKey:'h2',segmentCount:1,now:NOW,
  })
  assert.equal(r.allowed,false)
  assert.equal(r.reason,'SMS_QUOTA_EXHAUSTED')
})
await check('inactive add-on cannot reserve', async () => {
  const p=activeProfile(0); p.smsAddonStatus='inactive'
  const db=new FakeDb({users:{u1:p}})
  const r=await reserveSmsDelivery({
    db,tenantId:'u1',eventType:'mating',sourceRecordId:'c1',milestoneKey:'mating',
    idempotencyKey:'mating1',segmentCount:1,now:NOW,
  })
  assert.equal(r.allowed,false)
  assert.equal(r.reason,'SMS_ADDON_INACTIVE')
})
await check('invalid billing period fails closed', async () => {
  const p=activeProfile(0); p.smsPeriodEnd='2026-08-20T00:00:00.000Z'
  const db=new FakeDb({users:{u1:p}})
  const r=await reserveSmsDelivery({
    db,tenantId:'u1',eventType:'pregnancy',sourceRecordId:'c1',milestoneKey:'day28',
    idempotencyKey:'preg1',segmentCount:1,now:NOW,
  })
  assert.equal(r.allowed,false)
  assert.equal(r.reason,'SMS_BILLING_PERIOD_INVALID')
})
await check('provider failure refunds reserved credits', async () => {
  const db=new FakeDb({users:{u1:activeProfile(0)}})
  const r=await sendSmsWithQuota({
    db,tenantId:'u1',phone:'0412345678',message:'iDogs: Bella worming due 25 Aug 2026.',
    dogId:'d1',eventType:'worming',sourceRecordId:'w1',milestoneKey:'2026-08-25',
    idempotencyKey:'provider-fail',now:NOW,sendProvider:async()=>{throw new Error('provider')},
  })
  assert.equal(r.sent,false)
  assert.equal(r.reason,'PROVIDER_FAILED')
  assert.equal(db.store.users.u1.smsCreditsUsed,0)
})
await check('accepted provider send is charged once and marked sent', async () => {
  const db=new FakeDb({users:{u1:activeProfile(0)}})
  let sends=0
  const args={
    db,tenantId:'u1',phone:'0412345678',message:'iDogs: Bella vaccination due 25 Aug 2026.',
    dogId:'d1',eventType:'vaccination',sourceRecordId:'v1',milestoneKey:'2026-08-25',
    idempotencyKey:'provider-ok',now:NOW,sendProvider:async()=>{sends++;return {MessageId:'m1'}},
  }
  assert.equal((await sendSmsWithQuota(args)).sent,true)
  const retry=await sendSmsWithQuota(args)
  assert.equal(retry.sent,false)
  assert.equal(retry.reason,'DUPLICATE')
  assert.equal(sends,1)
  assert.equal(db.store.users.u1.smsCreditsUsed,1)
})
await check('manual failure refund never drops below zero', async () => {
  const db=new FakeDb({
    users:{u1:activeProfile(0)},
    smsDeliveries:{d1:{status:'reserved',segmentCount:3}},
  })
  await markSmsDeliveryFailed({db,tenantId:'u1',deliveryId:'d1',now:NOW})
  assert.equal(db.store.users.u1.smsCreditsUsed,0)
})
function fakeRes(){
  return { statusCode:200, body:null, status(n){this.statusCode=n;return this}, json(v){this.body=v;return this} }
}
await check('SMS checkout fails closed when Stripe price is missing', async () => {
  const handler=createSmsAddonCheckoutHandler({
    verifyIdToken:async()=>({uid:'u1'}),
    getProfile:async()=>({plan:'plus',subscriptionStatus:'active',stripeCustomerId:'cus_1'}),
    createSession:async()=>{throw new Error('must not call')},
    getPriceId:()=>undefined,
    getAppUrl:()=> 'https://example.test',
  })
  const res=fakeRes()
  await handler({method:'POST',headers:{authorization:'Bearer ok'},body:{}},res)
  assert.equal(res.statusCode,503)
})
await check('SMS checkout requires Plus', async () => {
  const handler=createSmsAddonCheckoutHandler({
    verifyIdToken:async()=>({uid:'u1'}),
    getProfile:async()=>({plan:'free',stripeCustomerId:'cus_1'}),
    createSession:async()=>({url:'https://stripe.test'}),
    getPriceId:()=> 'price_sms',
    getAppUrl:()=> 'https://example.test',
  })
  const res=fakeRes()
  await handler({method:'POST',headers:{authorization:'Bearer ok'},body:{}},res)
  assert.equal(res.statusCode,403)
})
await check('client cannot inject arbitrary Stripe price id into SMS checkout', async () => {
  const handler=createSmsAddonCheckoutHandler({
    verifyIdToken:async()=>({uid:'u1'}),
    getProfile:async()=>({plan:'plus',subscriptionStatus:'active',stripeCustomerId:'cus_1'}),
    createSession:async()=>({url:'https://stripe.test'}),
    getPriceId:()=> 'price_sms',
    getAppUrl:()=> 'https://example.test',
  })
  const res=fakeRes()
  await handler({method:'POST',headers:{authorization:'Bearer ok'},body:{priceId:'evil'}},res)
  assert.equal(res.statusCode,400)
})

console.log(`SMS Add-on V1: ${passed}/${passed} PASS`)
