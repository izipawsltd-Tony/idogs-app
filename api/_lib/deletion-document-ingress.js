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
  async function begin({idToken,dogId,executionEnabled=false}={}){
    runtime()
    if(executionEnabled!==true)return {status:'held',code:'document_ingress_disabled'}
    if(typeof idToken!=='string'||!idToken||!validAccountId(dogId))throw fail('DOCUMENT_INGRESS_INPUT_INVALID')
    async function identity(){runtime();const token=await auth.verifyIdToken(idToken,true);if(!validAccountId(token.uid))throw fail('DOCUMENT_INGRESS_IDENTITY_INVALID');return token.uid}
    const uid=await identity(),dogRef=db.collection('dogs').doc(dogId)
    const leaseRef=db.collection(MUTATION_LEASES).doc(randomUUID()),epoch=randomUUID()
    const proof=await db.runTransaction(async tx=>{
      runtime();await assertAccountWritableTx(tx,db,uid)
      const snap=await tx.get(dogRef)
      if(!snap.exists||!canAddDogRecord(snap.data(),uid)||!versionOf(snap))throw fail('DOCUMENT_INGRESS_OWNERSHIP_REQUIRED')
      const dogVersion=versionOf(snap),dogHash=digest(snap.data())
      tx.create(leaseRef,{uids:[uid],operation:'api/upload-document.js',state:'active',startedAt:new Date().toISOString(),
        documentIngress:{schema:1,uid,dogId,dogVersion,dogHash,epoch,mode:'prototype-emulator'}})
      return {dogVersion,dogHash}
    })
    const binding={schema:1,uid,dogId,...proof,epoch,mode:'prototype-emulator'}
    async function owned(tx){
      runtime();await assertAccountWritableTx(tx,db,uid)
      const [ds,ls]=await Promise.all([tx.get(dogRef),tx.get(leaseRef)]),l=ls.data()
      if(!ds.exists||!canAddDogRecord(ds.data(),uid)||versionOf(ds)!==proof.dogVersion||digest(ds.data())!==proof.dogHash)throw fail('DOCUMENT_INGRESS_OWNERSHIP_CHANGED')
      if(l?.state!=='active'||digest(l.uids??null)!==digest([uid])||l.operation!=='api/upload-document.js'||digest(l.documentIngress??null)!==digest(binding))throw fail('DOCUMENT_INGRESS_LEASE_CHANGED')
    }
    async function principal(){if(await identity()!==uid)throw fail('DOCUMENT_INGRESS_IDENTITY_CHANGED')}
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
  return {begin,mode:'prototype-emulator'}
}
