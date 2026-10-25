import { DELETION_COLLECTION } from './account-deletion.js'
import { validAccountId } from './deletion-fence.js'
import { randomUUID } from 'node:crypto'
import { RENEWAL_TASK_COLLECTION } from './account-deletion-policy.js'

const fail = code => Object.assign(new Error(code), { code })

// Provider-neutral contract. No SDK is instantiated and no live adapter is
// wired here. Caller authorization/runtime checks remain mandatory.
export async function stopVerifiedDeletionRenewals({uid,revision,provider}) {
  if(!validAccountId(uid)||!Number.isSafeInteger(revision)||revision<1)throw fail('INVALID_DELETION_BILLING_REQUEST')
  const discovery=await provider.discover(uid)
  if(discovery?.uid!==uid||discovery.complete!==true||!Array.isArray(discovery.subscriptions)
    ||discovery.subscriptions.length>200||discovery.subscriptions.some(s=>s.ownerUid!==uid||!validAccountId(s.id)))throw fail('BILLING_DISCOVERY_UNCONFIRMED')
  const ids=[...new Set(discovery.subscriptions.map(s=>s.id))].sort()
  for(const id of ids){
    await provider.stopRenewal(id,{uid,idempotencyKey:`deletion/${uid}/${revision}/${id}`})
    const result=await provider.verify(id)
    if(result?.ownerUid!==uid||result.id!==id||result.renewalStopped!==true)throw fail('BILLING_STOP_UNCONFIRMED')
  }
  return {renewalStatus:ids.length?'verified_stopped':'verified_no_subscription'}
}

// Stop renewal independently of destructive inventory work. Cancellation never
// undoes an already stopped renewal. A stale attempt cannot update a new request.
export async function recordDeletionBillingAcceptance({db,uid,revision,provider,assertRuntime}) {
  if(typeof assertRuntime!=='function')throw fail('BILLING_RUNTIME_GUARD_REQUIRED')
  assertRuntime()
  if(provider?.mode!=='synthetic')throw fail('SYNTHETIC_BILLING_ACCEPTANCE_REQUIRED')
  if(!validAccountId(uid)||!Number.isSafeInteger(revision)||revision<1)throw fail('INVALID_DELETION_BILLING_REQUEST')
  const ref=db.collection(DELETION_COLLECTION).doc(uid)
  const epoch=randomUUID()
  const claimed=await db.runTransaction(async tx=>{
    const before=await tx.get(ref)
    if(!before.exists||before.data().revision!==revision||!['requested','review_required','cancelled'].includes(before.data().status))return false
    tx.update(ref,{billingCheckEpoch:epoch,renewalStatus:'pending_verification'})
    return true
  })
  if(!claimed)return
  let outcome
  try{outcome=await stopVerifiedDeletionRenewals({uid,revision,provider})}
  catch{outcome={renewalStatus:'review_required'}}
  assertRuntime()
  await db.runTransaction(async tx=>{
    const latest=await tx.get(ref)
    if(!latest.exists||latest.data().revision!==revision||latest.data().billingCheckEpoch!==epoch||!['requested','review_required','cancelled'].includes(latest.data().status))return
    const taskRef=db.collection(RENEWAL_TASK_COLLECTION).doc(`${uid}_${revision}`),task=await tx.get(taskRef)
    const checkedAt=new Date().toISOString()
    tx.update(ref,{...outcome,renewalCheckedAt:checkedAt})
    if(task.exists)tx.update(taskRef,{status:outcome.renewalStatus,updatedAt:checkedAt,verificationMode:'synthetic-emulator'})
  })
}
