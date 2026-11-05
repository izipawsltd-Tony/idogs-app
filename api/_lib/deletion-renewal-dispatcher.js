import { randomUUID, createHash } from 'node:crypto'
import { DELETION_POLICY_VERSION, RENEWAL_TASK_COLLECTION } from './account-deletion-policy.js'
import { requireDeletionEmulators, validAccountId } from './deletion-fence.js'

const fail = code => Object.assign(new Error(code), { code })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const accepted = new Set(['requested', 'review_required', 'processing', 'cancelled', 'completed'])
const verified = new Set(['verified_stopped', 'verified_no_subscription'])
const leaseMs = 60000, maxAttempts = 5
const signature = t => hash([t.uid,t.revision,t.policyVersion,t.acceptedAt,t.cancellationMode,t.scope,t.restartOnDeletionCancellation,t.billingIdentityHash])

// There is no live adapter, HTTP route, scheduler or Production enable flag.
// The only deployed callers remain unchanged. The local wrapper validates all
// three emulator services before this internal, injected engine can do IO.
export function createEmulatorRenewalDispatcher({ db, auth, bucket, projectId, provider, clock }) {
  const assertRuntime = () => requireDeletionEmulators({ db, auth, bucket, projectId })
  assertRuntime()
  if(provider?.mode !== 'synthetic')throw fail('RENEWAL_SYNTHETIC_PROVIDER_REQUIRED')
  return createGuardedRenewalDispatcher({ db, provider, assertRuntime, mode:'prototype-emulator', clock })
}

export function createGuardedRenewalDispatcher({ db, provider, assertRuntime, mode, clock=Date.now }) {
  if(typeof assertRuntime!=='function' || typeof clock!=='function'
    || !['prototype-emulator','isolated-cloud-qa'].includes(mode)
    || provider?.mode!==(mode==='prototype-emulator'?'synthetic':'isolated-cloud-qa')
    || ['discover','stopRenewal','verify'].some(key=>typeof provider[key]!=='function'))throw fail('RENEWAL_GUARDED_RUNTIME_REQUIRED')
  let observed=-1
  function now() {
    const value=clock()
    if(!Number.isSafeInteger(value)||value<observed||value<0||value>8640000000000000-3600000)throw fail('RENEWAL_CLOCK_INVALID')
    observed=value
    return value
  }
  function bound(request,task,uid,revision) {
    if(!request||!task||request.uid!==uid||task.uid!==uid||request.revision!==revision||task.revision!==revision
      ||!accepted.has(request.status)||request.policyVersion!==DELETION_POLICY_VERSION||task.policyVersion!==request.policyVersion
      ||task.acceptedAt!==request.acceptedAt||!Number.isFinite(Date.parse(task.acceptedAt))||Date.parse(task.acceptedAt)>now()
      ||task.cancellationMode!=='period_end'||task.scope!=='verified_subscriptions_existing_at_acceptance'
      ||task.restartOnDeletionCancellation!==false)throw fail('RENEWAL_REQUEST_BINDING_CHANGED')
  }
  async function execute({ uid, revision }) {
    await assertRuntime(uid)
    if(!validAccountId(uid)||!Number.isSafeInteger(revision)||revision<1)throw fail('RENEWAL_INPUT_INVALID')
    const taskRef=db.collection(RENEWAL_TASK_COLLECTION).doc(`${uid}_${revision}`)
    const requestRef=db.collection('accountDeletionRequests').doc(uid), epoch=randomUUID()
    let original, attempt, acceptedAt, billingIdentityHash
    const claim=await db.runTransaction(async tx=>{
      await assertRuntime(uid)
      const [rs,ts]=await Promise.all([tx.get(requestRef),tx.get(taskRef)]),r=rs.data(),t=ts.data()
      bound(r,t,uid,revision)
      if(t.dispatchState==='completed') {
        const receipt=t.verificationReceipt
        if(!Array.isArray(t.subscriptionIds)||t.subscriptionIds.length>200||t.subscriptionIds.some(id=>!validAccountId(id))
          ||hash(t.subscriptionIds)!==hash([...new Set(t.subscriptionIds)].sort())
          ||!verified.has(t.status)||receipt?.schema!==1||receipt.uid!==uid||receipt.revision!==revision
          ||receipt.bindingHash!==signature(t)||receipt.mode!==mode||receipt.renewalStatus!==t.status
          ||receipt.subscriptionIdsHash!==hash(t.subscriptionIds)||!Number.isFinite(Date.parse(receipt.verifiedAt)))throw fail('RENEWAL_RECEIPT_CHANGED')
        return {status:'completed',duplicate:true,renewalStatus:t.status}
      }
      if(r.status==='completed')return {status:'held',code:'account_already_completed'}
      if(t.executionEnabled!==true)return {status:'held',code:'execution_disabled'}
      if(typeof t.billingIdentityHash!=='string'||!/^[a-f0-9]{64}$/.test(t.billingIdentityHash))return {status:'held',code:'acceptance_billing_binding_missing'}
      if(t.dispatchState==='review_required')return {status:'held',code:'billing_review_required'}
      if(t.leaseUntil!==undefined&&(!Number.isSafeInteger(t.leaseUntil)||t.leaseUntil<0))throw fail('RENEWAL_LEASE_INVALID')
      const time=now()
      if(t.leaseUntil>time)return {status:'busy'}
      if(t.nextAttemptAt!==undefined&&t.nextAttemptAt!==null) {
        const due=Date.parse(t.nextAttemptAt)
        if(!Number.isFinite(due))throw fail('RENEWAL_RETRY_TIME_INVALID')
        if(due>time)return {status:'held',code:'retry_not_due'}
      }
      if(t.attempts!==undefined&&(!Number.isSafeInteger(t.attempts)||t.attempts<0))throw fail('RENEWAL_ATTEMPTS_INVALID')
      if((t.attempts||0)>=maxAttempts) {
        tx.update(taskRef,{status:'review_required',dispatchState:'review_required',leaseUntil:0,nextAttemptAt:null,issueCode:'attempt_limit'})
        tx.update(requestRef,{renewalStatus:'review_required'})
        return {status:'held',code:'attempt_limit'}
      }
      original=signature(t);attempt=(t.attempts||0)+1;acceptedAt=Date.parse(t.acceptedAt);billingIdentityHash=t.billingIdentityHash
      tx.update(taskRef,{dispatchState:'processing',dispatchEpoch:epoch,leaseUntil:time+leaseMs,attempts:attempt,nextAttemptAt:null,updatedAt:new Date(time).toISOString()})
      return null
    })
    if(claim)return claim
    async function owned(tx) {
      await assertRuntime(uid)
      const [rs,ts]=await Promise.all([tx.get(requestRef),tx.get(taskRef)]),t=ts.data()
      bound(rs.data(),t,uid,revision)
      if(t.executionEnabled!==true||t.dispatchEpoch!==epoch||t.dispatchState!=='processing'||!Number.isSafeInteger(t.leaseUntil)
        ||t.leaseUntil<=now()||t.attempts!==attempt
        ||signature(t)!==original)throw fail('RENEWAL_STALE_ATTEMPT')
      return t
    }
    async function keepLease() {
      await assertRuntime(uid)
      await db.runTransaction(async tx=>{await owned(tx);tx.update(taskRef,{leaseUntil:now()+leaseMs})})
    }
    try {
      await keepLease()
      const discovery=await provider.discover(uid)
      if(discovery?.billingIdentityHash!==billingIdentityHash)throw fail('RENEWAL_BILLING_IDENTITY_CHANGED')
      if(discovery?.uid!==uid||discovery.complete!==true||!Array.isArray(discovery.subscriptions)||discovery.subscriptions.length>200
        ||discovery.subscriptions.some(s=>s?.ownerUid!==uid||!validAccountId(s.id)))throw fail('RENEWAL_DISCOVERY_UNCONFIRMED')
      if(discovery.subscriptions.some(s=>!Number.isFinite(Date.parse(s.createdAt))||Date.parse(s.createdAt)>acceptedAt))throw fail('RENEWAL_ACCEPTANCE_INVENTORY_UNCONFIRMED')
      const ids=[...new Set(discovery.subscriptions.map(s=>s.id))].sort(), inventoryHash=hash(ids)
      await db.runTransaction(async tx=>{
        const task=await owned(tx)
        if(task.subscriptionIds!==undefined&&hash(task.subscriptionIds)!==inventoryHash)throw fail('RENEWAL_INVENTORY_CHANGED')
        tx.update(taskRef,{subscriptionIds:ids})
      })
      for(const id of ids) {
        await keepLease()
        const ref=taskRef.collection('receipts').doc(hash(id)),prior=await ref.get()
        if(prior.exists) {
          const p=prior.data()
          if(p.uid!==uid||p.revision!==revision||p.subscriptionId!==id||p.inventoryHash!==inventoryHash
            ||p.bindingHash!==original||p.mode!==mode||p.renewalStopped!==true)throw fail('RENEWAL_PROVIDER_RECEIPT_CHANGED')
        } else {
          await keepLease()
          await provider.stopRenewal(id,{uid,idempotencyKey:`deletion/${uid}/${revision}/${id}`,assertExecution:keepLease})
        }
        await keepLease()
        const result=await provider.verify(id)
        if(result?.id!==id||result.ownerUid!==uid||result.renewalStopped!==true)throw fail('RENEWAL_STOP_UNCONFIRMED')
        await assertRuntime(uid)
        await db.runTransaction(async tx=>{
          await owned(tx)
          tx.set(ref,{uid,revision,subscriptionId:id,inventoryHash,bindingHash:original,mode,renewalStopped:true,verifiedAt:new Date(now()).toISOString()})
        })
      }
      await keepLease()
      const renewalStatus=ids.length?'verified_stopped':'verified_no_subscription'
      await db.runTransaction(async tx=>{
        await owned(tx)
        const checkedAt=new Date(now()).toISOString()
        tx.update(taskRef,{status:renewalStatus,dispatchState:'completed',executionEnabled:false,leaseUntil:0,updatedAt:checkedAt,
          verificationReceipt:{schema:1,uid,revision,epoch,bindingHash:original,subscriptionIdsHash:inventoryHash,renewalStatus,verifiedAt:checkedAt,mode}})
        tx.update(requestRef,{renewalStatus,renewalCheckedAt:checkedAt})
      })
      return {status:'completed',renewalStatus}
    } catch(error) {
      if(['RENEWAL_STALE_ATTEMPT','RENEWAL_REQUEST_BINDING_CHANGED'].includes(error.code))return {status:'superseded'}
      await assertRuntime(uid)
      const transient=['ETIMEDOUT','ECONNRESET','ECONNREFUSED'].includes(error.code)||error.type==='StripeConnectionError'
        ||Number.isInteger(error.statusCode)&&error.statusCode>=500&&error.statusCode<=599
      const retry=transient&&attempt<maxAttempts, time=now()
      try {
        await db.runTransaction(async tx=>{
          await owned(tx)
          tx.update(taskRef,{status:'review_required',dispatchState:retry?'retry_wait':'review_required',leaseUntil:0,
            nextAttemptAt:retry?new Date(time+Math.min(60000*2**(attempt-1),3600000)).toISOString():null,
            issueCode:retry?'provider_retry_required':'billing_verification_required',updatedAt:new Date(time).toISOString()})
          tx.update(requestRef,{renewalStatus:'review_required',renewalCheckedAt:new Date(time).toISOString()})
        })
      } catch(stale) {
        if(['RENEWAL_STALE_ATTEMPT','RENEWAL_REQUEST_BINDING_CHANGED'].includes(stale.code))return {status:'superseded'}
        throw stale
      }
      return {status:retry?'retry_wait':'review_required'}
    }
  }
  return {execute,mode}
}
