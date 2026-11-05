import {Storage,IdempotencyStrategy} from '@google-cloud/storage'
import {createHash} from 'node:crypto'
import {requireDeletionEmulators,validAccountId} from './deletion-fence.js'
import {digest} from './deletion-plan.js'

const fail=code=>Object.assign(new Error(code),{code})
export const documentBytesHash=bytes=>createHash('sha256').update(bytes).digest('hex')
export const documentStorageIntentHash=i=>digest({schema:i.schema,uid:i.uid,dogId:i.dogId,bucket:i.bucket,path:i.path,
  size:i.size,contentHash:i.contentHash,mediaType:i.mediaType,attemptId:i.attemptId,scopeHash:i.scopeHash})

// A private non-retrying client for actual LOCAL emulator IO. Never alter the
// shared Firebase Admin client's retry configuration or expose a live adapter.
export function createEmulatorDocumentStorage({db,auth,bucket,projectId,assertWrite}){
  requireDeletionEmulators({db,auth,bucket,projectId})
  if(typeof assertWrite!=='function')throw fail('DOCUMENT_STORAGE_EXECUTION_GUARD_REQUIRED')
  const host=process.env.FIREBASE_STORAGE_EMULATOR_HOST,endpoint=`http://${host}`
  if(process.env.STORAGE_EMULATOR_HOST!==endpoint)throw fail('DOCUMENT_STORAGE_ENDPOINT_REQUIRED')
  const storage=new Storage({projectId,apiEndpoint:endpoint,useAuthWithCustomEndpoint:false,
    retryOptions:{autoRetry:false,maxRetries:0,idempotencyStrategy:IdempotencyStrategy.RetryNever}})
  // This SDK version defaults a constructor value of zero back to three.
  // Enforce zero on THIS private client; the shared Admin client is untouched.
  storage.retryOptions.maxRetries=0
  const target=storage.bucket(bucket.name)
  function runtime(){
    requireDeletionEmulators({db,auth,bucket,projectId})
    if(process.env.FIREBASE_STORAGE_EMULATOR_HOST!==host||process.env.STORAGE_EMULATOR_HOST!==endpoint
      ||storage.apiEndpoint!==endpoint||storage.retryOptions.autoRetry!==false||storage.retryOptions.maxRetries!==0
      ||storage.retryOptions.idempotencyStrategy!==IdempotencyStrategy.RetryNever)throw fail('DOCUMENT_STORAGE_RUNTIME_CHANGED')
  }
  function intent(i){
    runtime()
    if(i?.schema!==1||!validAccountId(i.uid)||!validAccountId(i.dogId)||i.bucket!==bucket.name
      ||typeof i.path!=='string'||!i.path.startsWith(`documents/${i.uid}/${i.dogId}/`)||i.path.includes('..')||i.path.split('/').length!==4
      ||!Number.isSafeInteger(i.size)||i.size<1||i.size>10*1024*1024||typeof i.mediaType!=='string'||!i.mediaType
      ||!/^[a-f0-9]{64}$/.test(i.contentHash||'')||!/^[a-f0-9]{64}$/.test(i.scopeHash||'')
      ||!/^[a-f0-9-]{36}$/.test(i.attemptId||'')||i.hash!==documentStorageIntentHash(i))throw fail('DOCUMENT_STORAGE_INTENT_INVALID')
  }
  async function readback(i,expected){
    intent(i)
    const [meta]=await target.file(i.path).getMetadata()
    const generation=String(meta.generation||''),metageneration=String(meta.metageneration||'')
    if(!/^\d+$/.test(generation)||!/^\d+$/.test(metageneration)||String(meta.size)!==String(i.size)||meta.contentType!==i.mediaType
      ||meta.metadata?.idogsIntent!==i.hash||meta.metadata?.idogsAttempt!==i.attemptId
      ||meta.metadata?.idogsScope!==i.scopeHash
      ||expected&&(expected.generation!==generation||expected.metageneration!==metageneration))throw fail('DOCUMENT_STORAGE_READBACK_CHANGED')
    runtime()
    const [bytes]=await target.file(i.path,{generation}).download({validation:'crc32c',decompress:false})
    if(bytes.length!==i.size||documentBytesHash(bytes)!==i.contentHash)throw fail('DOCUMENT_STORAGE_CONTENT_CHANGED')
    return {schema:1,bucket:i.bucket,path:i.path,generation,metageneration,size:i.size,contentHash:i.contentHash,
      intentHash:i.hash,attemptId:i.attemptId,terminal:'single_nonretrying_save_resolved'}
  }
  async function send(i,bytes){
    intent(i)
    if(!Buffer.isBuffer(bytes)||bytes.length!==i.size||documentBytesHash(bytes)!==i.contentHash)throw fail('DOCUMENT_STORAGE_CONTENT_CHANGED')
    // Preserve occupied paths even on emulator versions which ignore upload
    // CAS. This check does not substitute for provider-side atomic CAS.
    if((await target.file(i.path).exists())[0])throw fail('DOCUMENT_STORAGE_OBJECT_ALREADY_EXISTS')
    await assertWrite(i)
    runtime()
    await target.file(i.path).save(bytes,{resumable:false,timeout:5000,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
      metadata:{contentType:i.mediaType,metadata:{idogsIntent:i.hash,idogsAttempt:i.attemptId,idogsScope:i.scopeHash}}})
    // Reaching here is evidence from THIS non-retrying request, not an object
    // existence inference made by a replacement process after a lost reply.
    return readback(i)
  }
  async function verify(i,receipt){
    intent(i)
    if(receipt?.terminal!=='single_nonretrying_save_resolved'||receipt.schema!==1||receipt.intentHash!==i.hash
      ||receipt.attemptId!==i.attemptId||receipt.bucket!==i.bucket||receipt.path!==i.path||receipt.size!==i.size
      ||receipt.contentHash!==i.contentHash)throw fail('DOCUMENT_STORAGE_RECEIPT_CHANGED')
    const actual=await readback(i,receipt)
    if(digest(actual)!==digest(receipt))throw fail('DOCUMENT_STORAGE_RECEIPT_CHANGED')
    return actual
  }
  return {send,verify}
}
