import {createEmulatorIndependentLedger,scopedDeletionRequestBinding} from './deletion-independent-ledger.js'
import {makeEmulatorIntakePermit} from './deletion-intake-permit.js'
import {changeDeletionRequest,requireRecentAuthentication} from './account-deletion.js'
import {deletionCommitment} from './account-deletion-policy.js'
import {digest} from './deletion-plan.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code})}
export function createEmulatorDeletionIntake(options){
  const ledger=createEmulatorIndependentLedger(options),{db,ledgerDb,auth,uid,nonce}=options
  const runtime=()=>ledger.assertRuntime(),intentRef=ledgerDb.doc(`scopedDeletionIntakes/${uid}`)
  const requestRef=db.doc(`accountDeletionRequests/${uid}`),leaseRef=db.doc(`accountMutationLeases/intake_${nonce}`)
  function verify(i){
    const {hash,state,ackHash,withdrawal,...core}=i||{}
    ensure(core.schema===1&&core.uid===uid&&core.nonce===nonce&&Number.isSafeInteger(core.now)&&core.now>=0
      &&/^[a-f0-9]{64}$/.test(core.authHash||'')&&hash===digest(core)
      &&['prepared','dispatching','acknowledged','withdrawn'].includes(state),'DELETION_INTAKE_INTENT_CHANGED')
    const commitment=deletionCommitment(core.now)
    ensure(digest(core.binding)===digest(scopedDeletionRequestBinding({uid,revision:1,status:'requested',requestedAt:commitment.acceptedAt,...commitment},uid))
      &&core.requestHash===digest(core.binding)&&core.consentHash===digest({action:'request',confirmation:'DELETE MY ACCOUNT',uid,nonce,policyVersion:commitment.policyVersion}),'DELETION_INTAKE_INTENT_CHANGED')
    ensure(state==='acknowledged'?/^[a-f0-9]{64}$/.test(ackHash||''):ackHash===undefined,'DELETION_INTAKE_INTENT_CHANGED')
    if(state==='withdrawn'){
      const {hash:receiptHash,...receipt}=withdrawal||{}
      ensure(receipt.schema===1&&receipt.kind==='prepared_withdrawal'&&receipt.intentHash===hash&&receipt.authHash===core.authHash
        &&receipt.confirmationHash===digest({uid,nonce,intentHash:hash,confirmation:'CANCEL DELETION PREPARATION'})
        &&typeof receipt.at==='string'&&Number.isFinite(Date.parse(receipt.at))&&Date.parse(receipt.at)>=core.now
        &&receiptHash===digest(receipt),'DELETION_INTAKE_WITHDRAWAL_CHANGED')
    }else ensure(withdrawal===undefined,'DELETION_INTAKE_WITHDRAWAL_CHANGED')
    return i
  }
  async function identity(idToken){
    runtime();ensure(typeof idToken==='string'&&idToken,'DELETION_INTAKE_AUTH_REQUIRED')
    const token=await auth.verifyIdToken(idToken,true);requireRecentAuthentication(token)
    ensure(token.uid===uid,'DELETION_INTAKE_ACCOUNT_MISMATCH')
    const user=await auth.getUser(uid)
    ensure(user.uid===uid&&!user.disabled,'DELETION_INTAKE_AUTH_REQUIRED')
    runtime()
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=synthetic&fields=users(localId,createdAt,email,phoneNumber,tenantId,disabled)`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken}),redirect:'error',signal:AbortSignal.timeout(5000)})
    ensure(response.ok,'DELETION_INTAKE_AUTH_EVIDENCE_REQUIRED')
    const body=await response.json(),r=body.users?.length===1?body.users[0]:null
    const createdAt=typeof r?.createdAt==='string'&&/^\d{1,16}$/.test(r.createdAt)?Number(r.createdAt):NaN
    ensure(r?.localId===uid&&!r.disabled&&Number.isSafeInteger(createdAt)&&createdAt>=0
      &&Math.floor(createdAt/1000)*1000===Date.parse(user.metadata.creationTime)
      &&(r.email||'').toLowerCase()===(user.email||'').toLowerCase()
      &&(r.phoneNumber||null)===(user.phoneNumber||null)&&(r.tenantId||null)===(user.tenantId||null),'DELETION_INTAKE_AUTH_EVIDENCE_REQUIRED')
    return {token,hash:digest({uid,createdAt,email:(user.email||'').toLowerCase(),phone:user.phoneNumber||null,tenant:user.tenantId||null,
      providers:user.providerData.map(p=>[p.providerId,p.uid]).sort()})}
  }
  async function load(){runtime();return verify((await intentRef.get()).data())}
  function marker(i){return {schema:1,uid,nonce,intentHash:i.hash,requestHash:i.requestHash}}
  async function sourceProof(i,tx){
    runtime()
    const request=(await tx.get(requestRef)).data(),lease=(await tx.get(leaseRef)).data()
    ensure(request&&digest(request.independentIntake??null)===digest(marker(i))&&digest(scopedDeletionRequestBinding(request,uid))===i.requestHash
      &&lease&&digest(lease.uids??null)===digest([uid])&&lease.operation==='emulator-deletion-intake'
      &&['active','closed'].includes(lease.state)&&digest(lease.intake??null)===digest(marker(i))
      &&(lease.state==='active'?lease.receiptHash===undefined:i.state==='acknowledged'&&lease.receiptHash===i.ackHash),'DELETION_INTAKE_SOURCE_RECEIPT_REQUIRED')
    return {request,lease}
  }
  async function prepare({idToken,confirmation}={}){
    ensure(confirmation==='DELETE MY ACCOUNT','DELETION_INTAKE_CONFIRMATION_REQUIRED')
    const actor=await identity(idToken)
    ensure(!(await requestRef.get()).exists,'DELETION_INTAKE_SOURCE_ALREADY_EXISTS')
    ensure(!(await ledger.read()).head,'DELETION_INTAKE_HISTORY_ALREADY_EXISTS')
    const now=Date.now(),commitment=deletionCommitment(now)
    const binding=scopedDeletionRequestBinding({uid,revision:1,status:'requested',requestedAt:commitment.acceptedAt,...commitment},uid)
    const core={schema:1,uid,nonce,now,authHash:actor.hash,binding,requestHash:digest(binding),
      consentHash:digest({action:'request',confirmation,uid,nonce,policyVersion:commitment.policyVersion})},proposal={...core,hash:digest(core),state:'prepared'}
    runtime()
    const result=await ledgerDb.runTransaction(async tx=>{
      runtime();const existing=(await tx.get(intentRef)).data()
      if(existing){verify(existing);ensure(existing.authHash===actor.hash&&existing.state==='prepared','DELETION_INTAKE_ALREADY_DISPATCHED');return existing}
      tx.create(intentRef,proposal);return proposal
    })
    return {status:'prepared',intentHash:result.hash,productionReady:false}
  }
  async function reconcile({idToken}={}){
    const actor=await identity(idToken),i=await load()
    ensure(i.authHash===actor.hash,'DELETION_INTAKE_IDENTITY_CHANGED')
    ensure(['dispatching','acknowledged'].includes(i.state),'DELETION_INTAKE_NOT_DISPATCHED')
    // Missing source data after an unknown write is NOT permission to resend.
    await db.runTransaction(tx=>sourceProof(i,tx))
    await ledger.publishAccepted()
    const chain=await ledger.read(),receipt=chain.events[0]
    ensure(receipt?.requestHash===i.requestHash,'DELETION_INTAKE_LEDGER_RECEIPT_REQUIRED')
    runtime()
    await ledgerDb.runTransaction(async tx=>{
      runtime();const current=verify((await tx.get(intentRef)).data())
      ensure(current.hash===i.hash&&current.authHash===actor.hash&&current.state!=='prepared','DELETION_INTAKE_INTENT_CHANGED')
      if(current.state==='acknowledged')ensure(current.ackHash===receipt.hash,'DELETION_INTAKE_ACK_CHANGED')
      else tx.update(intentRef,{state:'acknowledged',ackHash:receipt.hash})
    })
    const ack=await load();ensure(ack.state==='acknowledged'&&ack.ackHash===receipt.hash,'DELETION_INTAKE_ACK_REQUIRED')
    ensure((await identity(idToken)).hash===i.authHash,'DELETION_INTAKE_IDENTITY_CHANGED')
    runtime()
    const duplicate=await db.runTransaction(async tx=>{
      const {lease}=await sourceProof(ack,tx),lock=(await tx.get(db.doc(`accountDeletionLocks/${uid}`))).data()
      ensure(!lock||(lock.revision===1&&lock.state==='processing'),'DELETION_INTAKE_LOCK_CHANGED')
      if(lease.state==='closed'){ensure(lease.receiptHash===ack.ackHash,'DELETION_INTAKE_ACK_CHANGED');return true}
      tx.update(leaseRef,{state:'closed',closedAt:new Date().toISOString(),receiptHash:ack.ackHash})
      return false
    })
    return {status:'acknowledged',duplicate,intentHash:i.hash,receiptHash:ack.ackHash,sourcePublicationAtomic:false,productionReady:false}
  }
  async function accept({idToken}={}){
    const actor=await identity(idToken)
    runtime()
    const dispatch=await ledgerDb.runTransaction(async tx=>{
      runtime();const i=verify((await tx.get(intentRef)).data());ensure(i.authHash===actor.hash,'DELETION_INTAKE_IDENTITY_CHANGED')
      ensure(i.state!=='withdrawn','DELETION_INTAKE_WITHDRAWN')
      if(i.state!=='prepared')return {send:false,intent:i}
      ensure(Date.now()>=i.now&&Date.now()-i.now<=30000,'DELETION_INTAKE_PREPARATION_EXPIRED')
      tx.update(intentRef,{state:'dispatching'});return {send:true,intent:{...i,state:'dispatching'}}
    })
    if(dispatch.send){
      // The explicit user confirmation was verified by prepare and is bound
      // to this UID/nonce/policy in the immutable independent intent.
      const intakePermit=makeEmulatorIntakePermit({db,ledger,intent:dispatch.intent})
      await changeDeletionRequest({db,token:actor.token,body:{action:'request',confirmation:'DELETE MY ACCOUNT'},now:dispatch.intent.now,intakePermit})
    }
    return reconcile({idToken})
  }
  async function withdrawPrepared({idToken,confirmation}={}){
    ensure(confirmation==='CANCEL DELETION PREPARATION','DELETION_INTAKE_WITHDRAWAL_CONFIRMATION_REQUIRED')
    const actor=await identity(idToken)
    runtime()
    const duplicate=await ledgerDb.runTransaction(async tx=>{
      runtime();const i=verify((await tx.get(intentRef)).data())
      ensure(i.authHash===actor.hash,'DELETION_INTAKE_IDENTITY_CHANGED')
      if(i.state==='withdrawn')return true
      // Only the original never-dispatched state can become terminal. The
      // same transaction serializes against accept's dispatching transition.
      // Source absence, cancellation or elapsed time cannot satisfy this proof.
      ensure(i.state==='prepared','DELETION_INTAKE_ALREADY_DISPATCHED')
      const receipt={schema:1,kind:'prepared_withdrawal',intentHash:i.hash,authHash:i.authHash,
        confirmationHash:digest({uid,nonce,intentHash:i.hash,confirmation}),at:new Date().toISOString()}
      ensure(Date.parse(receipt.at)>=i.now,'DELETION_INTAKE_CLOCK_CHANGED')
      tx.update(intentRef,{state:'withdrawn',withdrawal:{...receipt,hash:digest(receipt)}})
      return false
    })
    const terminal=await load()
    ensure(terminal.state==='withdrawn'&&terminal.authHash===actor.hash,'DELETION_INTAKE_WITHDRAWAL_REQUIRED')
    ensure((await identity(idToken)).hash===actor.hash,'DELETION_INTAKE_IDENTITY_CHANGED')
    return {status:'prepared_withdrawn',duplicate,intentHash:terminal.hash,receiptHash:terminal.withdrawal.hash,
      sourceMutationReleased:false,accountAdmissionGranted:false,productionReady:false}
  }
  return {prepare,accept,reconcile,withdrawPrepared,ledger}
}
