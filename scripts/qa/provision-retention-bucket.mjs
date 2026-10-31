import {pathToFileURL} from 'node:url'
import {QA_RESOURCES,verifyQaBucket} from './provision-deletion-resources.mjs'
export const RETENTION_QA=Object.freeze({...QA_RESOURCES,bucket:'idogs-app-staging-retention-qa',retentionSeconds:604800})
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
export function retentionCredential(env){
 ensure(env.IDOGS_RETENTION_QA_APPROVAL==='2026-10-26-new-seven-day-qa-bucket','RETENTION_QA_OWNER_APPROVAL_REQUIRED')
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])ensure(!env[key],'RETENTION_QA_ENDPOINT_OVERRIDE')
 let c;try{c=JSON.parse(env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON)}catch{throw Object.assign(new Error('STAGING_CREDENTIAL_REQUIRED'),{code:'STAGING_CREDENTIAL_REQUIRED'})}
 ensure(c.type==='service_account'&&c.project_id===RETENTION_QA.projectId&&c.client_email?.endsWith('@idogs-app-staging.iam.gserviceaccount.com')&&c.private_key?.startsWith('-----BEGIN PRIVATE KEY-----'),'RETENTION_QA_CREDENTIAL_MISMATCH')
 return c
}
export function verifyRetentionBucket(m){
 ensure(m?.name===RETENTION_QA.bucket&&String(m.projectNumber)===RETENTION_QA.projectNumber&&m.location?.toLowerCase()===RETENTION_QA.location&&String(m.softDeletePolicy?.retentionDurationSeconds)==='604800'&&m.versioning?.enabled!==true&&!m.retentionPolicy&&m.iamConfiguration?.uniformBucketLevelAccess?.enabled===true&&m.iamConfiguration?.publicAccessPrevention==='enforced','RETENTION_QA_BUCKET_MISMATCH')
}
const policy=m=>JSON.stringify([m.name,m.projectNumber,m.metageneration,m.softDeletePolicy,m.versioning,m.retentionPolicy,m.iamConfiguration,m.cors])
export async function provisionRetentionBucket({env=process.env,loadStorage,report={}}){
 const credential=retentionCredential(env),storage=await loadStorage(credential)
 ensure(storage.projectId===RETENTION_QA.projectId,'RETENTION_QA_STORAGE_TARGET_MISMATCH')
 report.projectId=RETENTION_QA.projectId;report.bucket=RETENTION_QA.bucket;report.phase='verify_existing_buckets_read_only'
 const existing=storage.bucket(QA_RESOURCES.bucket),shared=storage.bucket(`${RETENTION_QA.projectId}.firebasestorage.app`)
 const [zero]=await existing.getMetadata(),[normal]=await shared.getMetadata();verifyQaBucket(zero)
 ensure(normal.name===`${RETENTION_QA.projectId}.firebasestorage.app`&&String(normal.projectNumber)===RETENTION_QA.projectNumber,'RETENTION_QA_SHARED_BUCKET_IDENTITY')
 report.phase='create_only_new_retention_qa_bucket'
 const bucket=storage.bucket(RETENTION_QA.bucket);let metadata
 try{[metadata]=await bucket.getMetadata()}catch(e){if(Number(e.code)!==404)throw e}
 if(!metadata){
  await storage.createBucket(RETENTION_QA.bucket,{location:RETENTION_QA.location,storageClass:'STANDARD',softDeletePolicy:{retentionDurationSeconds:604800},versioning:{enabled:false},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},labels:{idogs_purpose:'retention-qa',owner_approved:'2026-10-26'}})
  report.bucketCreated=true;[metadata]=await bucket.getMetadata()
 }
 verifyRetentionBucket(metadata)
 ensure(policy((await existing.getMetadata())[0])===policy(zero)&&policy((await shared.getMetadata())[0])===policy(normal),'RETENTION_QA_EXISTING_POLICY_CHANGED')
 Object.assign(report,{status:'retention_qa_bucket_verified',existingBucketsUnchanged:true,softDeleteSeconds:604800,actualSevenDayLifecyclePassed:false})
 return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report={status:'blocked'}
 try{await provisionRetentionBucket({report,loadStorage:async credential=>{const {Storage}=await import('@google-cloud/storage');return new Storage({projectId:RETENTION_QA.projectId,credentials:credential})}})}
 catch(e){report.status='blocked';report.code=/^[A-Za-z0-9_/-]{1,100}$/.test(String(e.code||''))?String(e.code):'RETENTION_QA_PROVISIONING_FAILED'}
 console.log(JSON.stringify(report,null,2));if(report.status!=='retention_qa_bucket_verified')process.exitCode=2
}
