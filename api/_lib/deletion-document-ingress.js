import {randomUUID} from 'node:crypto'
import {requireDeletionEmulators,validAccountId,assertAccountWritableTx,MUTATION_LEASES} from './deletion-fence.js'
import {canAddDogRecord} from './dog-access.js'
import {versionOf,digest} from './deletion-plan.js'
import {documentMetadata} from './document-upload-metadata.js'

const fail=code=>Object.assign(new Error(code),{code})
// Metadata-stage adapter only, deliberately unwired from live routes. This
// neither grants signed uploads nor claims external Storage IO has drained.
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
      binding={schema:2,uid,dogId,dogVersion:b.dogVersion,dogHash:b.dogHash,epoch:b.epoch,mode:b.mode,authHash:b.authHash,authEvidence:b.authEvidence}
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
    async function owned(tx){
      runtime();await assertAccountWritableTx(tx,db,uid)
      const [ds,ls]=await Promise.all([tx.get(dogRef),tx.get(leaseRef)]),l=ls.data()
      if(!ds.exists||!canAddDogRecord(ds.data(),uid)||versionOf(ds)!==binding.dogVersion||digest(ds.data())!==binding.dogHash)throw fail('DOCUMENT_INGRESS_OWNERSHIP_CHANGED')
      if(l?.state!=='active'||digest(l.uids??null)!==digest([uid])||l.operation!=='api/upload-document.js'||digest(l.documentIngress??null)!==digest(binding))throw fail('DOCUMENT_INGRESS_LEASE_CHANGED')
    }
    async function principal(){const current=await identity();if(current.uid!==uid||current.authHash!==binding.authHash)throw fail('DOCUMENT_INGRESS_IDENTITY_CHANGED')}
    async function assertRecordWrite(){await principal();await db.runTransaction(async tx=>{await owned(tx)})}
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
      const duplicate=await db.runTransaction(async tx=>{
        runtime()
        const lease=(await tx.get(leaseRef)).data()
        if(lease?.state==='closed'){
          const receipt=lease.documentRecord,snap=await tx.get(ref)
          if(digest(lease.documentIngress??null)!==digest(binding)||digest(lease.uids??null)!==digest([uid])
            ||lease.operation!=='api/upload-document.js'||receipt?.path!==ref.path||receipt.inputHash!==inputHash
            ||!snap.exists||digest(snap.data())!==receipt.contentHash)throw fail('DOCUMENT_INGRESS_RECEIPT_CHANGED')
          return true
        }
        await owned(tx)
        if((await tx.get(ref)).exists)throw fail('DOCUMENT_INGRESS_RECORD_EXISTS')
        tx.create(ref,data)
        tx.update(leaseRef,{state:'closed',closedAt:new Date().toISOString(),documentRecord:{path:ref.path,contentHash:digest(data),inputHash}})
        return false
      })
      return {status:'record_created',recordId,...(duplicate?{duplicate:true}:{})}
    }
    // No generic finally/abort closes an unknown external-write outcome. A
    // failed or abandoned session remains an active deletion hold for review.
    return {status:'claimed',leaseId:leaseRef.id,assertRecordWrite,createDocument}
  }
  return {begin:input=>open(input,false),resume:input=>open(input,true),mode:'prototype-emulator'}
}
