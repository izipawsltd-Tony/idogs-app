import {randomUUID} from 'node:crypto'
import {requireDeletionEmulators,validAccountId,assertAccountWritableTx,MUTATION_LEASES} from './deletion-fence.js'
import {canAddDogRecord} from './dog-access.js'
import {versionOf,digest} from './deletion-plan.js'
import {documentMetadata} from './document-upload-metadata.js'
import {createEmulatorDocumentStorage,documentBytesHash,documentStorageIntentHash} from './deletion-document-storage.js'

const fail=code=>Object.assign(new Error(code),{code})
// Guarded emulator-only session, deliberately unwired from live routes. This
// grants no signed upload authority and makes no global ingress-drain claim.
export function createEmulatorDocumentIngress({db,auth,bucket,projectId}){
  const runtime=()=>requireDeletionEmulators({db,auth,bucket,projectId})
  runtime()
  const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  async function open({idToken,dogId,leaseId,executionEnabled=false}={},resume=false){
    runtime()
    if(executionEnabled!==true)return {status:'held',code:'document_ingress_disabled'}
    if(typeof idToken!=='string'||!idToken||!validAccountId(dogId)||(resume?!uuid(leaseId):leaseId!==undefined))throw fail('DOCUMENT_INGRESS_INPUT_INVALID')
    async function identity(){
      runtime()
      const token=await auth.verifyIdToken(idToken,true)
      if(!validAccountId(token.uid))throw fail('DOCUMENT_INGRESS_IDENTITY_INVALID')
      const user=await auth.getUser(token.uid),createdAt=Date.parse(user.metadata?.creationTime)
      if(user.uid!==token.uid||user.disabled||!Number.isSafeInteger(createdAt)||createdAt<0)throw fail('DOCUMENT_INGRESS_IDENTITY_INVALID')
      // UserMetadata.creationTime loses milliseconds in the Admin SDK. Use
      // the end-user lookup against the validated LOCAL emulator only. No
      // admin export, password field, cloud credential or provider setting.
      runtime()
      const host=process.env.FIREBASE_AUTH_EMULATOR_HOST
      const response=await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=synthetic&fields=users(localId,createdAt,email,phoneNumber,tenantId,disabled)`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken}),redirect:'error',signal:AbortSignal.timeout(5000)})
      if(!response.ok)throw fail('DOCUMENT_INGRESS_AUTH_EVIDENCE_REQUIRED')
      const body=await response.json(),raw=body.users?.length===1?body.users[0]:null
      const precise=typeof raw?.createdAt==='string'&&/^\d{1,16}$/.test(raw.createdAt)?Number(raw.createdAt):NaN
      if(raw?.localId!==user.uid||raw.disabled===true||!Number.isSafeInteger(precise)||precise<0
        ||Math.floor(precise/1000)*1000!==createdAt
        ||(raw.email||'').trim().toLowerCase()!==(user.email||'').trim().toLowerCase()
        ||(raw.phoneNumber||null)!==(user.phoneNumber||null)||(raw.tenantId||null)!==(user.tenantId||null))throw fail('DOCUMENT_INGRESS_AUTH_EVIDENCE_REQUIRED')
      const authHash=digest({evidence:'end_user_createdAt_ms_v1',uid:user.uid,createdAt:precise,email:(user.email||'').trim().toLowerCase(),phone:user.phoneNumber||null,
        tenantId:user.tenantId||null,providers:(user.providerData||[]).map(p=>[p.providerId,p.uid]).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)})
      return {uid:token.uid,authHash}
    }
    const initial=await identity(),{uid}=initial,dogRef=db.collection('dogs').doc(dogId)
    const leaseRef=db.collection(MUTATION_LEASES).doc(resume?leaseId:randomUUID()),epoch=randomUUID()
    let binding
    if(resume){
      runtime()
      const lease=(await leaseRef.get()).data(),b=lease?.documentIngress
      // Older leases have no immutable Auth evidence. Never retrofit them
      // from a currently visible profile or create a replacement lease.
      if(b?.schema!==2||b.authEvidence!=='end_user_createdAt_ms_v1'||typeof b.authHash!=='string'||!/^[a-f0-9]{64}$/.test(b.authHash))throw fail('DOCUMENT_INGRESS_AUTH_BINDING_MISSING')
      if(b.uid!==uid||b.dogId!==dogId||b.mode!=='prototype-emulator'||!uuid(b.epoch)
        ||typeof b.dogVersion!=='string'||!/^\d+:\d+$/.test(b.dogVersion)||!/^[a-f0-9]{64}$/.test(b.dogHash||'')
        ||digest(lease.uids??null)!==digest([uid])||lease.operation!=='api/upload-document.js'||!['active','closed'].includes(lease.state))throw fail('DOCUMENT_INGRESS_LEASE_CHANGED')
      if(b.storageIntentHash!==undefined&&!/^[a-f0-9]{64}$/.test(b.storageIntentHash))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
      binding={schema:2,uid,dogId,dogVersion:b.dogVersion,dogHash:b.dogHash,epoch:b.epoch,mode:b.mode,authHash:b.authHash,authEvidence:b.authEvidence,
        ...(b.storageIntentHash?{storageIntentHash:b.storageIntentHash}:{})}
      if(digest(b)!==digest(binding))throw fail('DOCUMENT_INGRESS_LEASE_CHANGED')
      if(initial.authHash!==binding.authHash)throw fail('DOCUMENT_INGRESS_IDENTITY_CHANGED')
    }else binding=await db.runTransaction(async tx=>{
      runtime();await assertAccountWritableTx(tx,db,uid)
      const snap=await tx.get(dogRef)
      if(!snap.exists||!canAddDogRecord(snap.data(),uid)||!versionOf(snap))throw fail('DOCUMENT_INGRESS_OWNERSHIP_REQUIRED')
      const dogVersion=versionOf(snap),dogHash=digest(snap.data())
      const b={schema:2,uid,dogId,dogVersion,dogHash,epoch,mode:'prototype-emulator',authHash:initial.authHash,authEvidence:'end_user_createdAt_ms_v1'}
      tx.create(leaseRef,{uids:[uid],operation:'api/upload-document.js',state:'active',startedAt:new Date().toISOString(),documentIngress:b})
      return b
    })
    const scopeHash=()=>{const {storageIntentHash,...base}=binding;return digest(base)}
    async function storageProof(tx,lease){
      const hash=binding.storageIntentHash
      if(!hash){
        if(lease?.storageWrite!==undefined||(await tx.get(leaseRef.collection('storageIntents').limit(1))).size)throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
        return
      }
      const immutable=(await tx.get(leaseRef.collection('storageIntents').doc(hash))).data(),current=lease?.storageWrite?.intent
      if(!immutable||immutable.hash!==hash||documentStorageIntentHash(immutable)!==hash||immutable.scopeHash!==scopeHash()
        ||digest(immutable)!==digest(current??null))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
      const reservation=(await tx.get(db.collection(MUTATION_LEASES).doc(`document_storage_${uid}`).collection('paths').doc(digest([immutable.bucket,immutable.path])))).data()
      if(reservation?.leaseId!==leaseRef.id||reservation.intentHash!==hash||reservation.scopeHash!==scopeHash())throw fail('DOCUMENT_STORAGE_PATH_CLAIM_CHANGED')
    }
    async function owned(tx){
      runtime();await assertAccountWritableTx(tx,db,uid)
      const [ds,ls]=await Promise.all([tx.get(dogRef),tx.get(leaseRef)]),l=ls.data()
      if(!ds.exists||!canAddDogRecord(ds.data(),uid)||versionOf(ds)!==binding.dogVersion||digest(ds.data())!==binding.dogHash)throw fail('DOCUMENT_INGRESS_OWNERSHIP_CHANGED')
      if(l?.state!=='active'||digest(l.uids??null)!==digest([uid])||l.operation!=='api/upload-document.js'||digest(l.documentIngress??null)!==digest(binding))throw fail('DOCUMENT_INGRESS_LEASE_CHANGED')
      await storageProof(tx,l)
    }
    async function principal(){const current=await identity();if(current.uid!==uid||current.authHash!==binding.authHash)throw fail('DOCUMENT_INGRESS_IDENTITY_CHANGED')}
    async function assertRecordWrite(){await principal();await db.runTransaction(async tx=>{await owned(tx)})}
    let storage
    const writer=()=>storage||(storage=createEmulatorDocumentStorage({db,auth,bucket,projectId,assertWrite:async i=>{
      if(i.uid!==uid||i.dogId!==dogId||i.scopeHash!==scopeHash()||i.hash!==binding.storageIntentHash)throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
      await principal()
      await db.runTransaction(async tx=>{await owned(tx);const s=(await tx.get(leaseRef)).data().storageWrite;
        if(s?.state!=='dispatching'||s.intent?.hash!==i.hash)throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')})
    }}))
    async function writeStorage({filePath,content,mediaType}={}){
      await principal()
      if(!Buffer.isBuffer(content)||content.length<1||content.length>10*1024*1024
        ||typeof filePath!=='string'||!filePath.startsWith(`documents/${uid}/${dogId}/`)||filePath.includes('..')||filePath.split('/').length!==4
        ||!['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(mediaType))throw fail('DOCUMENT_STORAGE_INPUT_INVALID')
      const bytes=Buffer.from(content),transport=writer()
      const proposed={schema:1,uid,dogId,bucket:bucket.name,path:filePath,size:bytes.length,contentHash:documentBytesHash(bytes),
        mediaType,attemptId:randomUUID(),scopeHash:scopeHash()}
      proposed.hash=documentStorageIntentHash(proposed)
      const payload=i=>[i?.uid,i?.dogId,i?.bucket,i?.path,i?.size,i?.contentHash,i?.mediaType,i?.scopeHash]
      const claim=await db.runTransaction(async tx=>{
        await owned(tx)
        const previous=(await tx.get(leaseRef)).data().storageWrite
        if(previous!==undefined){
          if(digest(payload(previous.intent))!==digest(payload(proposed)))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
          if(previous.state!=='verified')throw fail('DOCUMENT_STORAGE_OUTCOME_UNKNOWN')
          return {duplicate:true,...previous}
        }
        const pathRef=db.collection(MUTATION_LEASES).doc(`document_storage_${uid}`).collection('paths').doc(digest([proposed.bucket,proposed.path]))
        if((await tx.get(pathRef)).exists)throw fail('DOCUMENT_STORAGE_PATH_ALREADY_CLAIMED')
        const state={state:'dispatching',intent:proposed}
        tx.create(leaseRef.collection('storageIntents').doc(proposed.hash),proposed)
        tx.create(pathRef,{leaseId:leaseRef.id,intentHash:proposed.hash,scopeHash:scopeHash()})
        tx.update(leaseRef,{storageWrite:state,documentIngress:{...binding,storageIntentHash:proposed.hash}})
        return state
      })
      if(claim.duplicate){await transport.verify(claim.intent,claim.receipt);return {status:'storage_verified',duplicate:true}}
      binding={...binding,storageIntentHash:claim.intent.hash}
      // Dispatch was durably recorded BEFORE the single non-retrying send.
      // A restart cannot infer a terminal response from current object state.
      try{
        await principal()
        await db.runTransaction(async tx=>{await owned(tx);if(digest((await tx.get(leaseRef)).data().storageWrite)!==digest(claim))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')})
        const receipt=await transport.send(claim.intent,bytes)
        await db.runTransaction(async tx=>{
          await owned(tx)
          const current=(await tx.get(leaseRef)).data().storageWrite
          if(digest(current)!==digest(claim))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
          tx.update(leaseRef,{storageWrite:{state:'verified',intent:claim.intent,receipt}})
        })
        return {status:'storage_verified'}
      }catch(error){
        const issueCode=/^DOCUMENT_[A-Z_]+$/.test(error.code||'')?error.code:Number.isInteger(error.code)?`storage_http_${error.code}`:'storage_transport_unverified'
        try{await db.runTransaction(async tx=>{
          await owned(tx)
          const current=(await tx.get(leaseRef)).data().storageWrite
          if(digest(current??null)===digest(claim))tx.update(leaseRef,{storageWrite:{state:'unknown',intent:claim.intent,issueCode}})
        })}catch{/* A lock/replacement leaves dispatching as an unresolved hold. */}
        throw Object.assign(fail('DOCUMENT_STORAGE_OUTCOME_UNKNOWN'),{issueCode})
      }
    }
    async function createDocument({recordId,metadata}={}){
      await principal()
      if(!validAccountId(recordId)||!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw fail('DOCUMENT_INGRESS_RECORD_INVALID')
      // Reject caller identity fields; construct stored ownership only from
      // the authenticated, pinned scope.
      if(['uid','tenantId','createdBy','ownerUid','currentOwnerId','dogId'].some(k=>Object.hasOwn(metadata,k)))throw fail('DOCUMENT_INGRESS_CALLER_IDENTITY_FORBIDDEN')
      const allowed=new Set(['documentType','title','notes','source','extractedData','fileName','filePath','mediaType'])
      if(Object.keys(metadata).some(k=>!allowed.has(k))||typeof metadata.fileName!=='string'
        ||typeof metadata.filePath!=='string'||!metadata.filePath.startsWith(`documents/${uid}/${dogId}/`)
        ||metadata.filePath.includes('..')||metadata.filePath.split('/').length!==4)throw fail('DOCUMENT_INGRESS_RECORD_INVALID')
      const data=documentMetadata({...metadata,uid,dogId,uploadedAt:new Date().toISOString()})
      const inputHash=digest({...data,uploadedAt:null})
      const ref=db.collection('documents').doc(recordId)
      const storageState=(await leaseRef.get()).data()?.storageWrite
      if(storageState!==undefined){
        if(storageState.state!=='verified')throw fail('DOCUMENT_STORAGE_OUTCOME_UNKNOWN')
        if(storageState.intent?.path!==metadata.filePath||storageState.intent.mediaType!==metadata.mediaType
          ||storageState.intent.scopeHash!==scopeHash())throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
        await writer().verify(storageState.intent,storageState.receipt)
      }
      const duplicate=await db.runTransaction(async tx=>{
        await principal()
        runtime()
        const lease=(await tx.get(leaseRef)).data()
        if(digest(lease?.storageWrite??null)!==digest(storageState??null))throw fail('DOCUMENT_STORAGE_INTENT_CHANGED')
        await storageProof(tx,lease)
        const pathClaim=(await tx.get(db.collection(MUTATION_LEASES).doc(`document_storage_${uid}`).collection('paths').doc(digest([bucket.name,metadata.filePath])))).data()
        if(pathClaim&&(pathClaim.leaseId!==leaseRef.id||pathClaim.intentHash!==binding.storageIntentHash))throw fail('DOCUMENT_STORAGE_PATH_CLAIM_CHANGED')
        if(lease?.state==='closed'){
          const receipt=lease.documentRecord,snap=await tx.get(ref)
          if(digest(lease.documentIngress??null)!==digest(binding)||digest(lease.uids??null)!==digest([uid])
            ||lease.operation!=='api/upload-document.js'||receipt?.path!==ref.path||receipt.inputHash!==inputHash
            ||receipt.storageReceiptHash!==(storageState?digest(storageState):undefined)
            ||!snap.exists||digest(snap.data())!==receipt.contentHash)throw fail('DOCUMENT_INGRESS_RECEIPT_CHANGED')
          return true
        }
        await owned(tx)
        if((await tx.get(ref)).exists)throw fail('DOCUMENT_INGRESS_RECORD_EXISTS')
        tx.create(ref,data)
        tx.update(leaseRef,{state:'closed',closedAt:new Date().toISOString(),documentRecord:{path:ref.path,contentHash:digest(data),inputHash,
          ...(storageState?{storageReceiptHash:digest(storageState)}:{})}})
        return false
      })
      return {status:'record_created',recordId,...(duplicate?{duplicate:true}:{})}
    }
    // No generic finally/abort closes an unknown external-write outcome. A
    // failed or abandoned session remains an active deletion hold for review.
    return {status:'claimed',leaseId:leaseRef.id,assertRecordWrite,writeStorage,createDocument}
  }
  return {begin:input=>open(input,false),resume:input=>open(input,true),mode:'prototype-emulator'}
}
