import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { requireDeletionEmulators, DELETION_LOCKS, MUTATION_LEASES, DELETION_JOBS, DELETION_RECEIPTS, validAccountId } from './deletion-fence.js'
import { buildEmulatorDeletionPlan, scanDeletionDocuments, versionOf, digest, containsDeletionIdentity } from './deletion-plan.js'

const day = 86400000
const fail = code => Object.assign(new Error(code),{code,status:409})
const publicStages = new Set(['checking','waiting_for_writes','waiting_for_storage','review_required','removing_data','verifying','completed'])
const identityHash = user => digest({uid:user.uid,createdAt:user.metadata.creationTime,email:user.email||null,phone:user.phoneNumber||null,providers:(user.providerData||[]).map(p=>({id:p.providerId,uid:p.uid,email:p.email||null})).sort((a,b)=>a.id.localeCompare(b.id)||a.uid.localeCompare(b.uid))})

// Only an injected SYNTHETIC provider adapter is accepted, and only after the
// real emulator service identities/hosts have been checked. There is no live
// Stripe/Resend/SMS adapter, scheduled dispatcher or production enable switch.
export function createEmulatorDeletionProcessor({ db, auth, bucket, projectId, provider, clock = Date.now }) {
  requireDeletionEmulators({db,auth,bucket,projectId})
  if (provider?.mode !== 'synthetic') throw fail('SYNTHETIC_PROVIDER_REQUIRED')
  const requestRef = uid => db.collection('accountDeletionRequests').doc(uid)
  const jobRef = uid => db.collection(DELETION_JOBS).doc(uid)
  const lockRef = uid => db.collection(DELETION_LOCKS).doc(uid)

  async function owned(tx, uid, revision, lease) {
    const [request,job,lock] = await Promise.all([tx.get(requestRef(uid)),tx.get(jobRef(uid)),tx.get(lockRef(uid))])
    if (!request.exists || request.data().revision !== revision || request.data().status !== 'processing'
      || !job.exists || job.data().revision !== revision || job.data().lease !== lease || job.data().leaseUntil <= clock()
      || !lock.exists || lock.data().revision !== revision) throw fail('STALE_DELETION_WORKER')
    return {request:request.data(),job:job.data()}
  }
  async function stage(uid,revision,lease,processingStage,extra={}) {
    if (!publicStages.has(processingStage)) throw fail('INVALID_PROCESSING_STAGE')
    await db.runTransaction(async tx => {
      await owned(tx,uid,revision,lease)
      const update = {processingStage,...extra,updatedAt:new Date(clock()).toISOString(),nextUpdateDueAt:new Date(clock()+day).toISOString()}
      tx.update(requestRef(uid),update)
      tx.update(jobRef(uid),{stage:processingStage,leaseUntil:clock()+60000})
    })
  }
  async function release(uid,revision,lease) {
    await db.runTransaction(async tx => {
      const snap=await tx.get(jobRef(uid))
      if(snap.exists && snap.data().revision===revision && snap.data().lease===lease) tx.update(jobRef(uid),{leaseUntil:0})
    })
  }
  async function hold(uid,revision,lease,code) {
    await stage(uid,revision,lease,code==='active_mutations'?'waiting_for_writes':'review_required',{issueCode:code})
    return {status:'held',code}
  }

  async function process({uid,revision,decisions={},limits,afterOperation}) {
    requireDeletionEmulators({db,auth,bucket,projectId})
    if(!validAccountId(uid)||!Number.isInteger(revision)||revision<1)throw fail('INVALID_DELETION_JOB')
    const lease=randomUUID(),now=clock()
    const claimed=await db.runTransaction(async tx=>{
      const [request,job,lock]=await Promise.all([tx.get(requestRef(uid)),tx.get(jobRef(uid)),tx.get(lockRef(uid))])
      if(!request.exists||request.data().revision!==revision)throw fail('DELETION_REQUEST_MISMATCH')
      if(request.data().status==='completed')return false
      if(!['requested','review_required','processing'].includes(request.data().status))throw fail('DELETION_NOT_ACCEPTED')
      if(job.exists && job.data().revision!==revision)throw fail('DELETION_JOB_REVISION_MISMATCH')
      if(job.exists && job.data().leaseUntil>now)throw fail('DELETION_WORKER_BUSY')
      if(lock.exists && lock.data().revision!==revision)throw fail('DELETION_LOCK_REVISION_MISMATCH')
      tx.set(lockRef(uid),{revision,state:'processing',lockedAt:lock.data()?.lockedAt||new Date(now).toISOString()})
      tx.set(jobRef(uid),{...(job.exists?job.data():{}),revision,lease,leaseUntil:now+60000,stage:'checking',mode:'prototype-emulator'})
      tx.update(requestRef(uid),{status:'processing',processingStage:'checking',targetAt:request.data().targetAt||new Date(Date.parse(request.data().requestedAt)+7*day).toISOString(),nextUpdateDueAt:new Date(now+day).toISOString(),updatedAt:new Date(now).toISOString()})
      return true
    })
    if(!claimed)return {status:'completed',duplicate:true}
    try {
      const active=await db.collection(MUTATION_LEASES).where('uids','array-contains',uid).where('state','==','active').limit(1).get()
      if(!active.empty)return await hold(uid,revision,lease,'active_mutations')
      const job=(await jobRef(uid).get()).data()
      // Provider request keys are stable across lost responses and retries.
      // A snapshot taken before the first cancellation is durably preserved.
      let subscriptionIds=job.subscriptionIds
      if(!subscriptionIds){
        const discovery=await provider.discover(uid)
        if(discovery?.complete!==true || discovery.uid!==uid || !Array.isArray(discovery.subscriptions)
          || discovery.subscriptions.some(s=>s.ownerUid!==uid||typeof s.id!=='string'))return await hold(uid,revision,lease,'billing_provider_verification')
        subscriptionIds=[...new Set(discovery.subscriptions.map(s=>s.id))].sort()
        await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease);tx.update(jobRef(uid),{subscriptionIds})})
      }
      for(const id of subscriptionIds){
        await stage(uid,revision,lease,'checking')
        await provider.stopRenewal(id,{uid,idempotencyKey:`deletion/${uid}/${revision}/${id}`})
        const result=await provider.verify(id)
        if(result?.ownerUid!==uid||result.renewalStopped!==true)return await hold(uid,revision,lease,'billing_provider_verification')
      }
      const providerEvidence=await provider.retention(uid)
      if(providerEvidence?.verified!==true||providerEvidence.uid!==uid||providerEvidence.restoreReplayVerified!==true||providerEvidence.mediaIngressDrained!==true)return await hold(uid,revision,lease,'provider_retention_review')
      const storageRetentionSeconds=providerEvidence.storageRetentionSeconds
      if(!Number.isSafeInteger(storageRetentionSeconds)||storageRetentionSeconds<0||storageRetentionSeconds>90*86400)return await hold(uid,revision,lease,'storage_retention_unverified')
      await stage(uid,revision,lease,'checking',{renewalStatus:subscriptionIds.length?'verified_stopped':'verified_no_subscription'})
      let currentJob=(await jobRef(uid).get()).data()
      if(!currentJob.planReady){
        const plan=await buildEmulatorDeletionPlan({db,bucket,uid,now:clock(),decisions,limits})
        if(plan.holds.length)return await hold(uid,revision,lease,plan.holds[0])
        let identity
        try{identity=await auth.getUser(uid)}catch{return await hold(uid,revision,lease,'auth_identity_missing')}
        // Staging the whole plan is restartable. No destructive operation runs
        // until planReady is committed. A retry overwrites only this revision.
        for(let index=0;index<plan.operations.length;index++){
          if(index%25===0)await stage(uid,revision,lease,'checking')
          const op=plan.operations[index]
          await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease);tx.set(jobRef(uid).collection('operations').doc(String(index).padStart(6,'0')),{...op,index,revision})})
        }
        await db.runTransaction(async tx=>{
          await owned(tx,uid,revision,lease)
          tx.update(jobRef(uid),{planReady:true,storageRetentionSeconds,fingerprint:plan.fingerprint,operationCount:plan.operations.length,operationHashes:plan.operations.map(digest),retained:plan.retained,authCreatedAt:identity.metadata.creationTime,authIdentityHash:identityHash(identity),profileEmailHashes:[...new Set([plan.profileEmailHash,digest((identity.email||'').toLowerCase())])],stage:'removing_data'})
        })
        currentJob=(await jobRef(uid).get()).data()
      }
      if(currentJob.storageRetentionSeconds!==storageRetentionSeconds)return await hold(uid,revision,lease,'storage_policy_changed')
      // Firestore locks do not freeze Firebase Auth. Disable and revoke sessions
      // before the first destructive operation; verify the same bound identity
      // on every retry. A failed freeze leaves the data untouched.
      await stage(uid,revision,lease,'checking')
      let frozen
      try{frozen=await auth.getUser(uid)}catch(e){if(e.code!=='auth/user-not-found'||!currentJob.authRemovalAttempted)throw fail('AUTH_IDENTITY_MISSING')}
      if(frozen){
        if(!currentJob.authIdentityHash||identityHash(frozen)!==currentJob.authIdentityHash)throw fail('AUTH_IDENTITY_CHANGED')
        await auth.updateUser(uid,{disabled:true})
        await auth.revokeRefreshTokens(uid)
        const confirmed=await auth.getUser(uid)
        if(confirmed.disabled!==true||identityHash(confirmed)!==currentJob.authIdentityHash)throw fail('AUTH_FREEZE_UNCONFIRMED')
        await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease);tx.update(jobRef(uid),{authFrozen:true})})
      }
      async function operation(index){
        const op=(await jobRef(uid).collection('operations').doc(String(index).padStart(6,'0')).get()).data()
        if(!op||op.revision!==revision||op.index!==index)throw fail('DELETION_PLAN_INCOMPLETE')
        const {index:storedIndex,revision:storedRevision,...plannedOperation}=op
        if(digest(plannedOperation)!==currentJob.operationHashes?.[index])throw fail('DELETION_PLAN_CHANGED')
        return op
      }
      await stage(uid,revision,lease,'removing_data')
      for(let index=0;index<currentJob.operationCount;index++){
        const op=await operation(index)
        const receipt=jobRef(uid).collection('receipts').doc(String(index).padStart(6,'0'))
        if(op.kind==='media'){
          await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease)})
          if(!(await receipt.get()).exists){
            const file=bucket.file(op.path)
            try{await file.delete({ifGenerationMatch:op.generation})}catch(e){if(Number(e.code)!==404)throw fail('MEDIA_VERSION_CONFLICT')}
            const [exists]=await file.exists()
            if(exists)throw fail('MEDIA_REMOVAL_UNCONFIRMED')
            await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease);tx.set(receipt,{revision,kind:op.kind,at:new Date(clock()).toISOString()})})
          }
        }else{
          await db.runTransaction(async tx=>{
            await owned(tx,uid,revision,lease)
            if((await tx.get(receipt)).exists)return
            const ref=db.doc(op.path),snap=await tx.get(ref)
            if(!snap.exists||versionOf(snap)!==op.expectedVersion)throw fail('RECORD_VERSION_CONFLICT')
            if(op.kind==='delete')tx.delete(ref)
            else if(op.kind==='redact')tx.update(ref,op.changes)
            else throw fail('INVALID_DELETION_OPERATION')
            tx.set(receipt,{revision,kind:op.kind,at:new Date(clock()).toISOString()})
          })
        }
        if(afterOperation)await afterOperation({index,kind:op.kind})
        await stage(uid,revision,lease,'removing_data')
      }
      await stage(uid,revision,lease,'verifying')
      let storageReviewAt=0,hasMedia=false
      // Verify each operation, including completed receipts after a restart.
      for(let index=0;index<currentJob.operationCount;index++){
        const id=String(index).padStart(6,'0'),op=await operation(index)
        const receipt=await jobRef(uid).collection('receipts').doc(id).get()
        if(!receipt.exists)throw fail('DELETION_RECEIPT_MISSING')
        if(op.kind==='media'){
          hasMedia=true
          if((await bucket.file(op.path).exists())[0])throw fail('MEDIA_REMOVAL_UNCONFIRMED')
          const removedAt=Date.parse(receipt.data().at)
          if(!Number.isFinite(removedAt))throw fail('MEDIA_RECEIPT_TIME_MISSING')
          storageReviewAt=Math.max(storageReviewAt,removedAt+storageRetentionSeconds*1000)
        }
        else{
          const snap=await db.doc(op.path).get()
          if(op.kind==='delete'&&snap.exists)throw fail('RECORD_REMOVAL_UNCONFIRMED')
          if(op.kind==='redact'&&(!snap.exists||Object.entries(op.changes).some(([path,value])=>snap.get(path)!==value)))throw fail('REDACTION_UNCONFIRMED')
        }
      }
      const scan=await scanDeletionDocuments(db)
      if(scan.holds.length)throw fail('FINAL_INVENTORY_INCOMPLETE')
      const approvedRetained=new Set(currentJob.retained.map(r=>r.path))
      if(scan.records.some(r=>!approvedRetained.has(r.path)&&(r.path.startsWith(`users/${uid}/`)||r.path===`users/${uid}`||containsDeletionIdentity(r.data,uid,currentJob.profileEmailHashes))))throw fail('RESIDUAL_ACCOUNT_RECORD')
      if(hasMedia&&storageRetentionSeconds>0){
        if(clock()<storageReviewAt){
          await stage(uid,revision,lease,'waiting_for_storage',{storageReviewAfter:new Date(storageReviewAt).toISOString()})
          return {status:'held',code:'storage_retention_pending'}
        }
        // Elapsed time alone does not prove that recoverable copies disappeared.
        if(providerEvidence.storageRecoveryVerified!==true)return await hold(uid,revision,lease,'storage_recovery_verification')
      }
      await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease)})
      try{
        const identity=await auth.getUser(uid)
        if(identity.disabled!==true||identityHash(identity)!==currentJob.authIdentityHash)throw fail('AUTH_IDENTITY_CHANGED')
        await db.runTransaction(async tx=>{await owned(tx,uid,revision,lease);tx.update(jobRef(uid),{authRemovalAttempted:true})})
        await auth.deleteUser(uid)
      }catch(e){if(e.code!=='auth/user-not-found')throw e}
      try{await auth.getUser(uid);throw fail('AUTH_REMOVAL_UNCONFIRMED')}catch(e){if(e.code!=='auth/user-not-found')throw e}
      const confirmation=await provider.confirm(uid,{idempotencyKey:`deletion-confirmation/${uid}/${revision}`})
      if(confirmation?.uid!==uid||confirmation.accepted!==true||confirmation.mode!=='synthetic')throw fail('CONFIRMATION_UNCONFIRMED')
      await db.runTransaction(async tx=>{
        await owned(tx,uid,revision,lease)
        const completedAt=new Date(clock()).toISOString()
        tx.update(requestRef(uid),{status:'completed',processingStage:'completed',completedAt,updatedAt:completedAt,issueCode:FieldValue.delete(),retainedCategories:[...new Set(currentJob.retained.map(r=>r.category))]})
        tx.update(lockRef(uid),{state:'completed',completedAt})
        tx.update(jobRef(uid),{stage:'completed',leaseUntil:0})
        tx.set(db.collection(DELETION_RECEIPTS).doc(digest([uid,revision])),{revision,completedAt,fingerprint:currentJob.fingerprint,confirmation:'synthetic-emulator-only',retainedCategories:[...new Set(currentJob.retained.map(r=>r.category))]})
      })
      return {status:'completed',revision}
    }catch(e){
      // Persist an actionable status, without leaking provider errors or data.
      try{await stage(uid,revision,lease,'review_required',{issueCode:'processing_needs_review'})}catch{}
      throw e
    }finally{await release(uid,revision,lease)}
  }
  return {process,mode:'prototype-emulator'}
}
