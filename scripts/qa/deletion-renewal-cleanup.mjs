import {digest} from '../../api/_lib/deletion-plan.js'
import {deletionBillingIdentityHash} from '../../api/_lib/account-deletion-policy.js'
const ensure=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code})}

// Explicit context, usable both in normal finally cleanup and in bounded
// recovery. No closure over a try-block-only scope; no recursive task deletion.
export async function cleanupRenewalReceipts({scope,db,manifest}){
 const {uid}=manifest
 ensure(scope?.uid===uid&&manifest.disposable===true,'QA_CLEANUP_RENEWAL_SCOPE_CHANGED')
 await scope.assertRuntime(uid)
 const taskRef=db.doc(`accountDeletionRenewalTasks/${uid}_1`),task=await taskRef.get()
 const collections=await taskRef.listCollections()
 ensure(collections.every(c=>c.id==='receipts'),'QA_CLEANUP_RENEWAL_COLLECTION_CHANGED')
 const receipts=await taskRef.collection('receipts').limit(2).get()
 ensure(receipts.size<=1,'QA_CLEANUP_RENEWAL_RECEIPTS_CHANGED')
 if(receipts.size){
  const t=task.data(),v=t?.verificationReceipt
  const binding=t&&digest([t.uid,t.revision,t.policyVersion,t.acceptedAt,t.cancellationMode,t.scope,t.restartOnDeletionCancellation,t.billingIdentityHash])
  ensure(t?.uid===uid&&t.revision===1&&t.status==='verified_stopped'&&t.dispatchState==='completed'
   &&t.executionEnabled===false&&t.billingIdentityHash===deletionBillingIdentityHash(manifest.stripeCustomerId)
   &&v?.uid===uid&&v.revision===1&&v.mode==='isolated-cloud-qa'&&v.bindingHash===binding,'QA_CLEANUP_RENEWAL_TASK_CHANGED')
  for(const snap of receipts.docs){
   const r=snap.data()
   ensure(snap.id===digest(manifest.stripeSubscriptionId)&&r.uid===uid&&r.revision===1
    &&r.subscriptionId===manifest.stripeSubscriptionId&&r.mode==='isolated-cloud-qa'&&r.bindingHash===binding
    &&r.inventoryHash===digest([manifest.stripeSubscriptionId])&&r.renewalStopped===true,'QA_CLEANUP_RENEWAL_RECEIPT_CHANGED')
   await scope.db.runTransaction(async tx=>{
    const [latest,current]=await Promise.all([tx.get(taskRef),tx.get(snap.ref)])
    ensure(latest.exists&&digest(latest.data())===digest(t)&&current.exists&&digest(current.data())===digest(r),'QA_CLEANUP_RENEWAL_RECEIPT_CHANGED')
    tx.delete(snap.ref)
   })
  }
 }
 ensure((await taskRef.collection('receipts').limit(1).get()).empty,'QA_CLEANUP_RENEWAL_RECEIPTS_REMAIN')
 return {renewalReceiptCleanupVerified:true}
}
