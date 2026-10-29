import {requireDeletionEmulators,validAccountId} from './deletion-fence.js'
import {digest} from './deletion-plan.js'
import {DELETION_POLICY_VERSION,DELETION_TARGET_MS} from './account-deletion-policy.js'

const fail=code=>Object.assign(new Error(code),{code})
const ensure=(ok,code)=>{if(!ok)throw fail(code)}
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)

// Prototype only: an actual separate emulator database, outside the default
// database's restore boundary. No cloud database, activation or global scan.
export function createEmulatorIndependentLedger({db,ledgerDb,auth,bucket,projectId,uid,nonce,executionEnabled=false}){
  function runtime(){
    requireDeletionEmulators({db,auth,bucket,projectId})
    ensure(projectId==='demo-idogs-deletion'&&db.databaseId==='(default)'&&ledgerDb?.projectId===projectId
      &&ledgerDb.databaseId==='idogs-deletion-ledger-qa'&&ledgerDb!==db,'INDEPENDENT_LEDGER_TARGET_INVALID')
    ensure(validAccountId(uid)&&uid.startsWith('synthetic-')&&uuid(nonce),'INDEPENDENT_LEDGER_SCOPE_INVALID')
    const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`)
    ensure([db,ledgerDb].every(client=>client._settings?.servicePath===endpoint.hostname&&client._settings.port===Number(endpoint.port)
      &&client._settings.ssl===false),'INDEPENDENT_LEDGER_ENDPOINT_CHANGED')
    ensure(executionEnabled===true,'INDEPENDENT_LEDGER_DISABLED')
  }
  runtime()
  const ref=ledgerDb.collection('scopedDeletionLedger').doc(uid)
  async function readTx(tx){
    runtime()
    // Establish the transaction with its header read before opening a query
    // stream, avoiding parallel first-read initialization in this adapter.
    const root=await tx.get(ref)
    const events=await tx.get(ref.collection('events').limit(3))
    if(!root.exists){ensure(events.empty,'INDEPENDENT_LEDGER_ORPHANED');return {head:null,events:[]}}
    const h=root.data();ensure(h.schema===1&&h.uid===uid&&h.nonce===nonce&&[1,2].includes(h.sequence)&&events.size===h.sequence,'INDEPENDENT_LEDGER_HEAD_CHANGED')
    let previous=null
    const list=events.docs.map((snap,i)=>{
      const e=snap.data(),{hash,...body}=e
      ensure(snap.id===String(i+1).padStart(6,'0')&&e.schema===1&&e.uid===uid&&e.nonce===nonce&&e.revision===1
        &&e.sequence===i+1&&e.kind===(i===0?'accepted':'completed')&&e.previous===previous
        &&hash===digest(body),'INDEPENDENT_LEDGER_CHAIN_CHANGED')
      previous=hash;return e
    })
    ensure(h.hash===previous&&h.requestHash===list[0].requestHash&&list.every(e=>e.requestHash===h.requestHash),'INDEPENDENT_LEDGER_HEAD_CHANGED')
    return {head:h,events:list}
  }
  function requestBinding(r){
    ensure(r?.uid===uid&&r.revision===1&&r.policyVersion===DELETION_POLICY_VERSION
      &&['requested','review_required','processing','completed'].includes(r.status)
      &&[r.requestedAt,r.acceptedAt,r.targetAt].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))
      &&r.requestedAt===r.acceptedAt&&Date.parse(r.targetAt)-Date.parse(r.acceptedAt)===DELETION_TARGET_MS, 'INDEPENDENT_LEDGER_REQUEST_INVALID')
    return {uid,revision:1,policyVersion:r.policyVersion,requestedAt:r.requestedAt,acceptedAt:r.acceptedAt,targetAt:r.targetAt}
  }
  async function publish(kind){
    runtime()
    // Read the source consistently, but do not claim a transaction spanning
    // both databases. A source change after this read invalidates publication.
    const source=await db.runTransaction(async tx=>{
      runtime()
      const request=(await tx.get(db.doc(`accountDeletionRequests/${uid}`))).data(),binding=requestBinding(request)
      if(kind==='accepted')return {binding,evidenceHash:digest(binding)}
      const [job,lock,receipt]=await Promise.all([tx.get(db.doc(`accountDeletionJobs/${uid}`)),tx.get(db.doc(`accountDeletionLocks/${uid}`)),
        tx.get(db.doc(`accountDeletionReceipts/${digest([uid,1])}`))])
      const j=job.data(),l=lock.data(),r=receipt.data()
      ensure(request.status==='completed'&&j?.stage==='completed'&&j.revision===1&&l?.state==='completed'&&l.revision===1
        &&r?.revision===1&&r.completedAt===request.completedAt&&l.completedAt===request.completedAt
        &&typeof r.fingerprint==='string'&&r.fingerprint===j.fingerprint,'INDEPENDENT_LEDGER_COMPLETION_REQUIRED')
      return {binding,evidenceHash:digest({completedAt:r.completedAt,fingerprint:r.fingerprint,retainedCategories:r.retainedCategories})}
    })
    if(kind==='completed'){
      try{await auth.getUser(uid);throw fail('INDEPENDENT_LEDGER_AUTH_REMAINS')}catch(e){if(e.code!=='auth/user-not-found')throw e}
    }
    const requestHash=digest(source.binding)
    runtime()
    const result=await ledgerDb.runTransaction(async tx=>{
      const current=await readTx(tx),sequence=kind==='accepted'?1:2,existing=current.events[sequence-1]
      if(existing){ensure(existing.requestHash===requestHash&&existing.evidenceHash===source.evidenceHash,'INDEPENDENT_LEDGER_RECEIPT_CHANGED');return {duplicate:true,sequence:current.head.sequence,hash:current.head.hash}}
      ensure(kind==='accepted'?!current.head:current.head?.sequence===1&&current.head.requestHash===requestHash,'INDEPENDENT_LEDGER_ACCEPTANCE_REQUIRED')
      const body={schema:1,uid,nonce,revision:1,sequence,kind,previous:current.head?.hash||null,requestHash,evidenceHash:source.evidenceHash}
      const hash=digest(body)
      tx.create(ref.collection('events').doc(String(sequence).padStart(6,'0')),{...body,hash})
      tx.set(ref,{schema:1,uid,nonce,sequence,hash,requestHash})
      return {duplicate:false,sequence,hash}
    })
    runtime()
    const latest=requestBinding((await db.doc(`accountDeletionRequests/${uid}`).get()).data())
    ensure(digest(latest)===requestHash,'INDEPENDENT_LEDGER_SOURCE_CHANGED')
    return {...result,mode:'separate-emulator-database',productionReady:false}
  }
  async function read(){runtime();return ledgerDb.runTransaction(readTx)}
  async function quarantine(){
    const before=await read()
    // Missing history is a hold, never permission to write. No heuristic based
    // on Auth creation dates can release a deletion receipt after import.
    if(!before.head)return {status:'held',code:'independent_ledger_missing',productionReady:false}
    let authState='absent'
    try{const u=await auth.getUser(uid);authState=u.disabled?'disabled':'enabled'}catch(e){if(e.code!=='auth/user-not-found')throw e}
    const after=await read();ensure(digest(after)===digest(before),'INDEPENDENT_LEDGER_WATERMARK_CHANGED')
    return {status:'held',code:authState==='absent'?'independent_deletion_receipt':'restored_auth_quarantine',authState,
      sequence:after.head.sequence,watermark:after.head.hash,receiptChainVerified:true,sourcePublicationAtomic:false,globalCompletenessVerified:false,productionReady:false}
  }
  async function assertWritable(verifiedUid){
    runtime();ensure(verifiedUid===uid,'INDEPENDENT_LEDGER_ACCOUNT_MISMATCH')
    const state=await quarantine()
    throw fail(state.code==='independent_ledger_missing'?'INDEPENDENT_LEDGER_HISTORY_REQUIRED':'INDEPENDENT_LEDGER_QUARANTINED')
  }
  return {publishAccepted:()=>publish('accepted'),publishCompleted:()=>publish('completed'),read,quarantine,assertWritable}
}
