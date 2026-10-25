import { pathToFileURL } from 'node:url'

export const target = Object.freeze({projectId:'idogs-app',projectNumber:'404409556051',bucket:'idogs-app.firebasestorage.app'})
const fail = code => Object.assign(new Error(code),{code})
const seconds = value => {
  if(value===undefined || value===null)return null
  const text=String(value)
  if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw fail('INVALID_METADATA')
  return text
}

// Only bucket.getMetadata is accepted; no file listing, downloads or writes.
// Output is an allowlist: never return credentials, ACLs, object paths or labels.
export async function inspectStorageMetadata({bucket,projectId,env=process.env,clock=Date.now}) {
  if(projectId!==target.projectId||bucket?.name!==target.bucket)throw fail('WRONG_STORAGE_TARGET')
  if(env.STORAGE_EMULATOR_HOST||env.FIREBASE_STORAGE_EMULATOR_HOST||env.GOOGLE_CLOUD_UNIVERSE_DOMAIN)throw fail('UNSUPPORTED_STORAGE_ENDPOINT')
  const [meta]=await bucket.getMetadata()
  if(meta?.name!==target.bucket||String(meta.projectNumber)!==target.projectNumber)throw fail('BUCKET_IDENTITY_MISMATCH')
  if(typeof meta.location!=='string'||!meta.location||!/^\d+$/.test(String(meta.metageneration||'')))throw fail('INCOMPLETE_METADATA')
  if(meta.versioning?.enabled!==undefined&&typeof meta.versioning.enabled!=='boolean')throw fail('INVALID_METADATA')
  const softDeleteSeconds=seconds(meta.softDeletePolicy?.retentionDurationSeconds)
  const retentionSeconds=seconds(meta.retentionPolicy?.retentionPeriod)
  return {
    mode:'read-only-bucket-metadata',observedAt:new Date(clock()).toISOString(),...target,
    location:meta.location,metageneration:String(meta.metageneration),
    versioning:meta.versioning?.enabled??null,
    softDeleteRetentionSeconds:softDeleteSeconds,
    bucketRetentionSeconds:retentionSeconds,
    retentionLocked:typeof meta.retentionPolicy?.isLocked==='boolean'?meta.retentionPolicy.isLocked:null,
    objectRetentionMode:meta.objectRetention?.mode==='Enabled'?'Enabled':null,
    lifecycleRuleCount:Array.isArray(meta.lifecycle?.rule)?meta.lifecycle.rule.length:null,
    // Metadata is not evidence of successful deletion or absence of backups.
    productionDeletionVerified:false,
    unresolved:['external_backup_inventory','restore_replay','media_ingress_drain','object_holds_and_versions'],
  }
}

export async function runStorageMetadata({env=process.env,loadClient}={}) {
  if(env.STORAGE_EMULATOR_HOST||env.FIREBASE_STORAGE_EMULATOR_HOST||env.GOOGLE_CLOUD_UNIVERSE_DOMAIN)throw fail('UNSUPPORTED_STORAGE_ENDPOINT')
  const client=await loadClient()
  return inspectStorageMetadata({bucket:client.bucket,projectId:client.projectId,env})
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const report=await runStorageMetadata({loadClient:async()=>{
      const {initializeApp,applicationDefault}=await import('firebase-admin/app')
      const {getStorage}=await import('firebase-admin/storage')
      const app=initializeApp({projectId:target.projectId,credential:applicationDefault(),storageBucket:target.bucket},'read-only-storage-metadata')
      return {projectId:app.options.projectId,bucket:getStorage(app).bucket()}
    }})
    console.log(JSON.stringify(report,null,2))
  }catch(error){
    // SDK error messages can contain URLs or credential details. Only emit codes.
    const known=new Set(['WRONG_STORAGE_TARGET','UNSUPPORTED_STORAGE_ENDPOINT','BUCKET_IDENTITY_MISMATCH','INCOMPLETE_METADATA','INVALID_METADATA'])
    console.error(JSON.stringify({status:'blocked',code:known.has(error.code)?error.code:'STORAGE_METADATA_ACCESS_REQUIRED'}))
    process.exitCode=1
  }
}
