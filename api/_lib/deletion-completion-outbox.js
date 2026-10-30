import {createEmulatorIndependentLedger,scopedDeletionRequestBinding} from './deletion-independent-ledger.js'
import {requireRecentAuthentication} from './account-deletion.js'
import {digest} from './deletion-plan.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code})}
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)

// Deliberately no sender, dispatch method, delivery state or Production adapter.
// Recipient data is private synthetic fixture data in the separate local DB.
export function createEmulatorDeletionCompletionOutbox(options){
  const ledger=createEmulatorIndependentLedger(options),{db,ledgerDb,auth,uid,nonce}=options
  const runtime=()=>ledger.assertRuntime(),intentRef=ledgerDb.doc(`scopedDeletionCompletionOutbox/${uid}`)
  const intakeRef=ledgerDb.doc(`scopedDeletionIntakes/${uid}`),requestRef=db.doc(`accountDeletionRequests/${uid}`)
  const leaseRef=db.doc(`accountMutationLeases/completion_capture_${nonce}`)
  const held=code=>({status:'held',code,productionReady:false})
  function verify(i){
    const {intentHash,state,completion,...body}=i||{}
    ensure(body.schema===1&&body.uid===uid&&body.nonce===nonce&&body.revision===1
      &&hash(body.authHash)&&hash(body.requestHash)&&hash(body.intakeHash)&&hash(body.acceptanceHash)
      &&body.recipient?.channel==='email'&&typeof body.recipient.address==='string'
      &&/^[A-Za-z0-9_.+-]+@example\.invalid$/.test(body.recipient.address)
      &&intentHash===digest(body)&&['captured','completion_bound_no_send'].includes(state),'DELETION_OUTBOX_INTENT_CHANGED')
    if(state==='captured')ensure(completion===undefined,'DELETION_OUTBOX_COMPLETION_CHANGED')
    else {
      const {hash:proofHash,...proof}=completion||{}
      ensure(proof.schema===1&&proof.intentHash===intentHash&&hash(proof.ledgerHash)&&hash(proof.evidenceHash)
        &&proofHash===digest(proof),'DELETION_OUTBOX_COMPLETION_CHANGED')
    }
    return i
  }
  function intake(i){
    const {hash:intakeHash,state,ackHash,withdrawal,...core}=i||{}
    ensure(core.schema===1&&core.uid===uid&&core.nonce===nonce&&intakeHash===digest(core)
      &&state==='acknowledged'&&hash(ackHash)&&withdrawal===undefined&&hash(core.authHash)
      &&core.requestHash===digest(scopedDeletionRequestBinding({...core.binding,status:'requested'},uid)),
    'DELETION_OUTBOX_INTAKE_REQUIRED')
    return {...i,intakeHash}
  }
  const marker=i=>({schema:1,uid,nonce,intentHash:i.intakeHash,requestHash:i.requestHash})
  async function actor(idToken){
    runtime();ensure(typeof idToken==='string'&&idToken,'DELETION_OUTBOX_AUTH_REQUIRED')
    const token=await auth.verifyIdToken(idToken,true);requireRecentAuthentication(token)
    ensure(token.uid===uid,'DELETION_OUTBOX_IDENTITY_CHANGED')
    const user=await auth.getUser(uid)
    ensure(user.uid===uid&&!user.disabled&&user.emailVerified&&/^[A-Za-z0-9_.+-]+@example\.invalid$/.test(user.email||''),'DELETION_OUTBOX_RECIPIENT_REQUIRED')
    runtime()
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=synthetic&fields=users(localId,createdAt,email,phoneNumber,tenantId,disabled)`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken}),redirect:'error',signal:AbortSignal.timeout(5000)})
    ensure(response.ok,'DELETION_OUTBOX_AUTH_REQUIRED')
    const body=await response.json(),r=body.users?.length===1?body.users[0]:null,createdAt=Number(r?.createdAt)
    ensure(r?.localId===uid&&!r.disabled&&typeof r.createdAt==='string'&&/^\d{1,16}$/.test(r.createdAt)
      &&Number.isSafeInteger(createdAt)&&createdAt>=0&&Math.floor(createdAt/1000)*1000===Date.parse(user.metadata.creationTime)
      &&(r.email||'').toLowerCase()===(user.email||'').toLowerCase()
      &&(r.phoneNumber||null)===(user.phoneNumber||null)&&(r.tenantId||null)===(user.tenantId||null),'DELETION_OUTBOX_IDENTITY_CHANGED')
    return {authHash:digest({uid,createdAt,email:user.email.toLowerCase(),phone:user.phoneNumber||null,tenant:user.tenantId||null,
      providers:user.providerData.map(p=>[p.providerId,p.uid]).sort()}),recipient:{channel:'email',address:user.email.toLowerCase()}}
  }
  function sourceRequest(request,i){
    ensure(request&&digest(scopedDeletionRequestBinding(request,uid))===i.requestHash
      &&digest(request.independentIntake??null)===digest(marker(i)),'DELETION_OUTBOX_SOURCE_CHANGED')
  }
  function leaseCheck(lease,i){
    ensure(lease&&digest(lease.uids)===digest([uid])&&lease.operation==='emulator-completion-recipient-capture'
      &&digest(lease.capture)===digest({schema:1,uid,nonce,intakeHash:i.intakeHash,requestHash:i.requestHash})
      &&['active','closed'].includes(lease.state)
      &&(lease.state==='active'?lease.receiptHash===undefined:hash(lease.receiptHash)),'DELETION_OUTBOX_LEASE_CHANGED')
  }
  async function capture({idToken}={}){
    const identity=await actor(idToken),i=intake((await intakeRef.get()).data()),chain=await ledger.read()
    ensure(i.authHash===identity.authHash,'DELETION_OUTBOX_IDENTITY_CHANGED')
    ensure(chain.head?.sequence===1&&chain.events[0].hash===i.ackHash&&chain.head.requestHash===i.requestHash,'DELETION_OUTBOX_ACCEPTANCE_REQUIRED')
    // The worker reads active mutation leases. Acquire this durable hold in the
    // source DB before publishing any claim that capture preceded Auth removal.
    const captureLeaseState=await db.runTransaction(async tx=>{
      runtime();const request=(await tx.get(requestRef)).data(),lock=(await tx.get(db.doc(`accountDeletionLocks/${uid}`))).data()
      const existing=(await tx.get(leaseRef)).data();sourceRequest(request,i)
      if(existing){
        leaseCheck(existing,i)
        ensure(['requested','review_required','processing'].includes(request.status)
          &&(!lock||(lock.revision===1&&lock.state==='processing'))
          &&(request.status!=='processing'||lock?.revision===1&&lock.state==='processing'),'DELETION_OUTBOX_LOCK_CHANGED')
        return existing.state
      }
      ensure(!lock&&['requested','review_required'].includes(request.status),'DELETION_OUTBOX_CAPTURE_TOO_LATE')
      tx.create(leaseRef,{uids:[uid],operation:'emulator-completion-recipient-capture',state:'active',startedAt:new Date().toISOString(),
        capture:{schema:1,uid,nonce,intakeHash:i.intakeHash,requestHash:i.requestHash}})
      return 'active'
    })
    const checked=await actor(idToken)
    ensure(digest(checked)===digest(identity),'DELETION_OUTBOX_IDENTITY_CHANGED')
    const body={schema:1,uid,nonce,revision:1,authHash:identity.authHash,recipient:identity.recipient,
      requestHash:i.requestHash,intakeHash:i.intakeHash,acceptanceHash:i.ackHash}
    const proposed={...body,intentHash:digest(body),state:'captured'}
    await ledgerDb.runTransaction(async tx=>{
      runtime();const saved=(await tx.get(intentRef)).data(),current=intake((await tx.get(intakeRef)).data())
      ensure(current.intakeHash===i.intakeHash&&current.ackHash===i.ackHash,'DELETION_OUTBOX_INTAKE_REQUIRED')
      if(saved){ensure(verify(saved).intentHash===proposed.intentHash,'DELETION_OUTBOX_INTENT_CHANGED');return}
      ensure(captureLeaseState==='active','DELETION_OUTBOX_CAPTURE_HISTORY_MISSING')
      tx.create(intentRef,proposed)
    })
    // Lost commit reply leaves the active lease. Restart verifies the exact
    // private receipt before closing only this capture's lease; no finally.
    const saved=verify((await intentRef.get()).data())
    ensure(saved.intentHash===proposed.intentHash,'DELETION_OUTBOX_INTENT_CHANGED')
    ensure((await actor(idToken)).authHash===identity.authHash,'DELETION_OUTBOX_IDENTITY_CHANGED')
    await db.runTransaction(async tx=>{
      runtime();const request=(await tx.get(requestRef)).data(),lease=(await tx.get(leaseRef)).data()
      const lock=(await tx.get(db.doc(`accountDeletionLocks/${uid}`))).data()
      sourceRequest(request,i);leaseCheck(lease,i)
      ensure(['requested','review_required','processing'].includes(request.status)
        &&(!lock||(lock.revision===1&&lock.state==='processing'))
        &&(request.status!=='processing'||lock?.revision===1&&lock.state==='processing'),'DELETION_OUTBOX_LOCK_CHANGED')
      if(lease.state==='closed')ensure(lease.receiptHash===saved.intentHash,'DELETION_OUTBOX_LEASE_CHANGED')
      else tx.update(leaseRef,{state:'closed',closedAt:new Date().toISOString(),receiptHash:saved.intentHash})
    })
    return {status:'captured',intentHash:saved.intentHash,productionReady:false}
  }
  async function authAbsent(){
    runtime();try{await auth.getUser(uid);return false}catch(e){if(e.code==='auth/user-not-found')return true;throw e}
  }
  async function evidence(i){
    runtime();const currentIntake=intake((await intakeRef.get()).data())
    ensure(currentIntake.intakeHash===i.intakeHash&&currentIntake.authHash===i.authHash
      &&currentIntake.ackHash===i.acceptanceHash,'DELETION_OUTBOX_INTAKE_REQUIRED')
    const chain=await ledger.read()
    if(chain.head?.sequence!==2)return null
    ensure(chain.events[0].hash===i.acceptanceHash&&chain.head.requestHash===i.requestHash,'DELETION_OUTBOX_COMPLETION_CHANGED')
    const proof=await db.runTransaction(async tx=>{
      runtime();const request=(await tx.get(requestRef)).data(),job=(await tx.get(db.doc(`accountDeletionJobs/${uid}`))).data()
      const lock=(await tx.get(db.doc(`accountDeletionLocks/${uid}`))).data(),receipt=(await tx.get(db.doc(`accountDeletionReceipts/${digest([uid,1])}`))).data()
      const lease=(await tx.get(leaseRef)).data()
      sourceRequest(request,i);leaseCheck(lease,i)
      ensure(lease.state==='closed'&&lease.receiptHash===i.intentHash,'DELETION_OUTBOX_CAPTURE_REQUIRED')
      ensure(request.status==='completed'&&job?.stage==='completed'&&job.revision===1&&lock?.state==='completed'&&lock.revision===1
        &&receipt?.revision===1&&typeof request.completedAt==='string'&&Number.isFinite(Date.parse(request.completedAt))
        &&receipt.completedAt===request.completedAt&&lock.completedAt===request.completedAt&&hash(receipt.fingerprint)
        &&receipt.fingerprint===job.fingerprint,'DELETION_OUTBOX_COMPLETION_REQUIRED')
      const evidenceHash=digest({completedAt:receipt.completedAt,fingerprint:receipt.fingerprint,retainedCategories:receipt.retainedCategories})
      ensure(evidenceHash===chain.events[1].evidenceHash,'DELETION_OUTBOX_COMPLETION_CHANGED')
      return {schema:1,intentHash:i.intentHash,ledgerHash:chain.head.hash,evidenceHash}
    })
    return {...proof,hash:digest(proof)}
  }
  async function bindCompletion(){
    runtime();const raw=(await intentRef.get()).data()
    if(!raw)return held('recipient_capture_missing')
    const i=verify(raw),proof=await evidence(i)
    if(!proof)return held('independent_completion_missing')
    if(!await authAbsent())return held('auth_present')
    ensure(digest(await evidence(i))===digest(proof),'DELETION_OUTBOX_COMPLETION_CHANGED')
    await ledgerDb.runTransaction(async tx=>{
      runtime();const current=verify((await tx.get(intentRef)).data())
      ensure(current.intentHash===i.intentHash,'DELETION_OUTBOX_INTENT_CHANGED')
      if(current.state==='completion_bound_no_send')ensure(digest(current.completion)===digest(proof),'DELETION_OUTBOX_COMPLETION_CHANGED')
      else tx.update(intentRef,{state:'completion_bound_no_send',completion:proof})
    })
    const saved=verify((await intentRef.get()).data())
    ensure(saved.intentHash===i.intentHash&&digest(saved.completion)===digest(proof)
      &&digest(await evidence(i))===digest(proof),'DELETION_OUTBOX_COMPLETION_CHANGED')
    if(!await authAbsent())return held('restored_auth_quarantine')
    return {status:'completion_bound_no_send',intentHash:i.intentHash,completionHash:proof.hash,productionReady:false}
  }
  return {capture,bindCompletion}
}
