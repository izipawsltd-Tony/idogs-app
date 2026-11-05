import { requireDeletionEmulators, assertAccountWritableTx, validAccountId, MUTATION_LEASES } from './deletion-fence.js'
import { digest } from './deletion-plan.js'
import { readEmulatorCancellationEvidence } from './deletion-stripe-transport.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:423})}
const providerId=(value,prefix)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(value)
const idOf=value=>typeof value==='string'?value:value?.id
const eventTypes=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_succeeded','invoice.payment_failed'])
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}

// No Production adapter, global users query, sender, close or timeout release.
// A verified invocation keeps its original durable lease until a separate
// terminal/authority-drain protocol can prove it is safe to release.
export async function prepareEmulatorVerifiedStripeEvent({db,auth,bucket,projectId,rawBody,signature,verifyEvent,getSubscription,cancelSubscription,reconcileCancellation,executionEnabled=false}){
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
  const guardedCancel=async(id,params={})=>{
    const pinnedParams=freeze(structuredClone(params))
    ensure(typeof cancelSubscription==='function','WEBHOOK_CANCEL_UNAVAILABLE')
    const discovered=await guardedSubscription(id)
    const intentRef=leaseRef.collection('externalIntents').doc(digest(id))
    const nonce=discovered.metadata?.deletionQaNonce
    const nonceBound=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nonce||'')
    const intent={schema:nonceBound?2:1,...(nonceBound?{nonceHash:digest(nonce)}:{}),eventHash,subscriptionHash:digest(id),paramsHash:digest(pinnedParams),state:'sending'}
    await db.runTransaction(async tx=>{
      await assertTx(tx);ensure(!(await tx.get(intentRef)).exists,'WEBHOOK_EXTERNAL_OUTCOME_HELD');tx.create(intentRef,intent)
    })
    await recheck()
    // Lost response retains the original intent and lease; never retry here.
    const result=await cancelSubscription(id,pinnedParams,{uid,eventId:event.id,eventHash,leasePath:leaseRef.path,intentHash:digest(intent)})
    await db.runTransaction(async tx=>{
      await assertTx(tx);const saved=await tx.get(intentRef)
      ensure(digest(saved.data())===digest(intent),'WEBHOOK_EXTERNAL_INTENT_CHANGED')
      tx.update(intentRef,{state:'response_observed',responseHash:digest(result??null)})
    })
    return result
  }
  async function reconcileOriginalCancellation(id){
    runtime();ensure(providerId(id,'sub'),'WEBHOOK_SUBSCRIPTION_BINDING_REQUIRED')
    const intentRef=leaseRef.collection('externalIntents').doc(digest(id)),receiptRef=leaseRef.collection('externalReceipts').doc(digest(id))
    // Observation may proceed while deletion is locked, but grants no writer
    // authority and never changes the original parent lease or source account.
    async function originalTx(tx){
      runtime();checkLease((await tx.get(leaseRef)).data())
      const profile=await tx.get(userRef),saved=(await tx.get(intentRef)).data()
      ensure(profile.exists&&profile.data().stripeCustomerId===customer,'WEBHOOK_CUSTOMER_BINDING_CHANGED')
      ensure(saved?.schema===2&&/^[a-f0-9]{64}$/.test(saved.nonceHash||'')&&saved.eventHash===eventHash&&saved.subscriptionHash===digest(id)
        &&/^[a-f0-9]{64}$/.test(saved.paramsHash||'')&&['sending','response_observed'].includes(saved.state),'WEBHOOK_EXTERNAL_INTENT_CHANGED')
      const intent={schema:2,nonceHash:saved.nonceHash,eventHash,subscriptionHash:saved.subscriptionHash,paramsHash:saved.paramsHash,state:'sending'}
      return {saved,intent,intentHash:digest(intent)}
    }
    function validate(receipt,original){
      const {hash,...body}=receipt||{},e=body.evidence
      ensure(body.schema===1&&body.kind==='loopback_cancellation_io_hold'&&body.intentHash===original.intentHash&&hash===digest(body)
        &&e?.schema===1&&e.kind==='loopback_cancellation_io'&&e.uid===uid&&e.eventId===event.id&&e.eventHash===eventHash
        &&e.intentHash===original.intentHash&&e.leasePath===leaseRef.path&&e.subscriptionId===id&&e.customerId===customer
        &&e.paramsHash===original.saved.paramsHash&&e.status==='canceled'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(e.nonce||'')&&digest(e.nonce)===original.saved.nonceHash
        &&[e.wire,e.readback].every(w=>w?.httpStatus===200&&/^req_[A-Za-z0-9_]{1,120}$/.test(w.requestId||'')),'WEBHOOK_CANCELLATION_RECEIPT_CHANGED')
      return receipt
    }
    const before=await db.runTransaction(async tx=>{
      const original=await originalTx(tx),existing=(await tx.get(receiptRef)).data()
      return {original,existing:existing?validate(existing,original):null}
    })
    if(before.existing)return {status:'io_receipt_recorded_hold',duplicate:true,receiptHash:before.existing.hash,freshProviderReadback:false,parentLeaseReleased:false,productionReady:false}
    ensure(typeof reconcileCancellation==='function','WEBHOOK_CANCELLATION_RECONCILER_REQUIRED')
    const branded=await reconcileCancellation(id,{uid,eventId:event.id,eventHash,leasePath:leaseRef.path,intentHash:before.original.intentHash})
    const evidence=readEmulatorCancellationEvidence(branded),body={schema:1,kind:'loopback_cancellation_io_hold',intentHash:before.original.intentHash,evidence}
    const receipt=validate({...body,hash:digest(body)},before.original)
    const duplicate=await db.runTransaction(async tx=>{
      const original=await originalTx(tx),existing=(await tx.get(receiptRef)).data()
      ensure(digest(original.saved)===digest(before.original.saved),'WEBHOOK_EXTERNAL_INTENT_CHANGED')
      if(existing){validate(existing,original);return true}
      tx.create(receiptRef,receipt);return false
    })
    const saved=validate((await receiptRef.get()).data(),before.original)
    return {status:'io_receipt_recorded_hold',duplicate,receiptHash:saved.hash,freshProviderReadback:true,parentLeaseReleased:false,productionReady:false}
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
  return {event,db:guardedDb,leasePath:leaseRef.path,assertExecution:recheck,getSubscription:guardedSubscription,cancelSubscription:guardedCancel,reconcileCancellation:reconcileOriginalCancellation,
    constructEvent:(body,sig)=>{const checked=verifyEvent(body,sig);ensure(digest(checked)===eventHash,'WEBHOOK_EVENT_CHANGED');return freeze(structuredClone(checked))}}
}