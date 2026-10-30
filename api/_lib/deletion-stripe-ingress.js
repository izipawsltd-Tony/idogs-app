import { requireDeletionEmulators, assertAccountWritableTx, validAccountId, MUTATION_LEASES } from './deletion-fence.js'
import { digest } from './deletion-plan.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:423})}
const providerId=(value,prefix)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(value)
const idOf=value=>typeof value==='string'?value:value?.id
const eventTypes=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_succeeded','invoice.payment_failed'])
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}

// No Production adapter, global users query, sender, close or timeout release.
// A verified invocation keeps its original durable lease until a separate
// terminal/authority-drain protocol can prove it is safe to release.
export async function prepareEmulatorVerifiedStripeEvent({db,auth,bucket,projectId,rawBody,signature,verifyEvent,getSubscription,cancelSubscription,executionEnabled=false}){
  ensure(executionEnabled===true,'WEBHOOK_INGRESS_DISABLED')
  const runtime=()=>requireDeletionEmulators({db,auth,bucket,projectId})
  runtime();ensure(typeof verifyEvent==='function'&&typeof signature==='string'&&Buffer.isBuffer(rawBody),'WEBHOOK_SIGNATURE_INPUT_REQUIRED')
  const raw=Buffer.from(rawBody)
  // Signature verification precedes ALL Firestore reads and all provider calls.
  const event=freeze(structuredClone(verifyEvent(raw,signature))),eventHash=digest(event)
  ensure(providerId(event?.id,'evt')&&event.livemode===false&&eventTypes.has(event.type),'WEBHOOK_EVENT_SCOPE_REQUIRED')
  const object=event.data?.object,customer=idOf(object?.customer)
  ensure(providerId(customer,'cus'),'WEBHOOK_CUSTOMER_BINDING_REQUIRED')
  let uid=object?.metadata?.userId
  if(!validAccountId(uid)&&event.type.startsWith('invoice.')){
    const subscriptionId=idOf(object.subscription||object.parent?.subscription_details?.subscription)
    ensure(providerId(subscriptionId,'sub')&&typeof getSubscription==='function','WEBHOOK_ACCOUNT_BINDING_REQUIRED')
    const subscription=await getSubscription(subscriptionId)
    ensure(subscription?.id===subscriptionId&&idOf(subscription.customer)===customer,'WEBHOOK_SUBSCRIPTION_BINDING_CHANGED')
    uid=subscription.metadata?.userId
  }
  ensure(validAccountId(uid)&&uid.startsWith('synthetic-'),'WEBHOOK_ACCOUNT_BINDING_REQUIRED')
  const userRef=db.collection('users').doc(uid),leaseRef=db.collection(MUTATION_LEASES).doc(`stripe_${digest([uid,event.id])}`)
  const binding={schema:1,eventId:event.id,eventHash,customerHash:digest(customer)}
  const checkLease=lease=>ensure(lease?.state==='active'&&lease.operation==='verified-stripe-webhook'
    &&digest(lease.uids)===digest([uid])&&digest(lease.stripeBinding)===digest(binding),'WEBHOOK_LEASE_CHANGED')
  async function identityTx(tx){
    runtime();await assertAccountWritableTx(tx,db,uid)
    const profile=await tx.get(userRef)
    ensure(profile.exists&&profile.data().stripeCustomerId===customer,'WEBHOOK_CUSTOMER_BINDING_CHANGED')
  }
  await db.runTransaction(async tx=>{
    await identityTx(tx);const existing=await tx.get(leaseRef)
    if(existing.exists)checkLease(existing.data())
    else tx.create(leaseRef,{uids:[uid],operation:'verified-stripe-webhook',state:'active',startedAt:new Date().toISOString(),stripeBinding:binding})
  })
  async function assertTx(tx){await identityTx(tx);checkLease((await tx.get(leaseRef)).data())}
  const recheck=()=>db.runTransaction(async tx=>{await assertTx(tx)})
  function subscriptionBinding(subscription,id){
    ensure(subscription?.id===id&&subscription.metadata?.userId===uid&&idOf(subscription.customer)===customer,'WEBHOOK_SUBSCRIPTION_BINDING_CHANGED')
  }
  const guardedSubscription=async id=>{
    ensure(providerId(id,'sub')&&typeof getSubscription==='function','WEBHOOK_SUBSCRIPTION_BINDING_REQUIRED')
    await recheck();const subscription=await getSubscription(id);subscriptionBinding(subscription,id)
    return structuredClone(subscription)
  }
  const guardedCancel=async(id,params)=>{
    ensure(typeof cancelSubscription==='function','WEBHOOK_CANCEL_UNAVAILABLE')
    await guardedSubscription(id)
    const intentRef=leaseRef.collection('externalIntents').doc(digest(id))
    const intent={schema:1,eventHash,subscriptionHash:digest(id),paramsHash:digest(params),state:'sending'}
    await db.runTransaction(async tx=>{
      await assertTx(tx);ensure(!(await tx.get(intentRef)).exists,'WEBHOOK_EXTERNAL_OUTCOME_HELD');tx.create(intentRef,intent)
    })
    await recheck()
    // Lost response retains the original intent and lease; never retry here.
    const result=await cancelSubscription(id,params)
    await db.runTransaction(async tx=>{
      await assertTx(tx);const saved=await tx.get(intentRef)
      ensure(digest(saved.data())===digest(intent),'WEBHOOK_EXTERNAL_INTENT_CHANGED')
      tx.update(intentRef,{state:'response_observed',responseHash:digest(result??null)})
    })
    return result
  }
  const guardedDb=new Proxy(db,{get(target,key){
    if(key==='runTransaction')return(fn,...args)=>target.runTransaction(async tx=>{await assertTx(tx);return fn(tx)},...args)
    if(key==='collection')return name=>{
      const collection=target.collection(name)
      if(name!=='users')return collection
      return new Proxy(collection,{get(ref,property){
        if(property==='doc')return id=>{ensure(id===uid,'WEBHOOK_FOREIGN_ACCOUNT');return ref.doc(id)}
        if(['get','where','listDocuments','orderBy','limit','count'].includes(property))return()=>{throw Error('WEBHOOK_GLOBAL_ACCOUNT_QUERY_FORBIDDEN')}
        const value=Reflect.get(ref,property,ref);return typeof value==='function'?value.bind(ref):value
      }})
    }
    if(key==='doc')return path=>{const segments=String(path).split('/');ensure(segments[0]!=='users'||segments[1]===uid,'WEBHOOK_FOREIGN_ACCOUNT');return target.doc(path)}
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
  }})
  return {event,db:guardedDb,leasePath:leaseRef.path,getSubscription:guardedSubscription,cancelSubscription:guardedCancel,
    constructEvent:(body,sig)=>{const checked=verifyEvent(body,sig);ensure(digest(checked)===eventHash,'WEBHOOK_EVENT_CHANGED');return freeze(structuredClone(checked))}}
}