import { pathToFileURL } from 'node:url'
export const QA_RESOURCES=Object.freeze({projectId:'idogs-app-staging',projectNumber:'530003937245',databaseId:'idogs-deletion-qa',bucket:'idogs-app-staging-deletion-qa',location:'asia-southeast1'})
export const QA_DENY_RULES="rules_version = '2';\n// Operator SDK fixtures only; every client request is denied.\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n"
const fail=code=>Object.assign(new Error(code),{code})
export function provisioningCredential(env){
 if(env.IDOGS_QA_RESOURCE_APPROVAL!=='2026-10-25-isolated-deletion-qa')throw fail('QA_RESOURCE_APPROVAL_REQUIRED')
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])if(env[key])throw fail('QA_ENDPOINT_OVERRIDE')
 let c;try{c=JSON.parse(env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON)}catch{throw fail('STAGING_CREDENTIAL_REQUIRED')}
 if(c.project_id!==QA_RESOURCES.projectId||c.type!=='service_account'||typeof c.client_email!=='string'||!c.client_email.endsWith('@idogs-app-staging.iam.gserviceaccount.com')||typeof c.private_key!=='string'||!c.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw fail('STAGING_CREDENTIAL_TARGET_MISMATCH')
 return c
}
export function verifyQaDatabase(d){
 if(d?.name!==`projects/${QA_RESOURCES.projectId}/databases/${QA_RESOURCES.databaseId}`||d.locationId!==QA_RESOURCES.location||d.type!=='FIRESTORE_NATIVE'||d.databaseEdition!=='STANDARD'||d.deleteProtectionState!=='DELETE_PROTECTION_ENABLED')throw fail('QA_DATABASE_CONFIGURATION_MISMATCH')
}
export function verifyQaBucket(m){
 if(m?.name!==QA_RESOURCES.bucket||String(m.projectNumber)!==QA_RESOURCES.projectNumber||m.location?.toLowerCase()!==QA_RESOURCES.location||String(m.softDeletePolicy?.retentionDurationSeconds)!=='0'||m.versioning?.enabled===true||m.retentionPolicy||m.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true||m.iamConfiguration?.publicAccessPrevention!=='enforced')throw fail('QA_BUCKET_CONFIGURATION_MISMATCH')
}

export async function provisionQaResources({env=process.env,loadClients,report={}}){
 const credential=provisioningCredential(env)
 const {api,storage,wait}=await loadClients(credential)
 const p=QA_RESOURCES.projectId,db=`projects/${p}/databases/${QA_RESOURCES.databaseId}`
 const firestore='https://firestore.googleapis.com/v1/',rules='https://firebaserules.googleapis.com/v1/'
 report.projectId=p;report.database=db;report.bucket=QA_RESOURCES.bucket
 report.phase='verify_staging_identity'
 const defaultMetadata=(await storage.bucket(`${p}.firebasestorage.app`).getMetadata())[0]
 if(String(defaultMetadata.projectNumber)!==QA_RESOURCES.projectNumber)throw fail('STAGING_PROJECT_NUMBER_MISMATCH')
 const originalDefaultRules=await api(`${rules}projects/${p}/releases/cloud.firestore`,{allow404:true})
 const originalDefaultDb=await api(`${firestore}projects/${p}/databases/(default)`)
 report.defaultEdition=originalDefaultDb.databaseEdition
 report.phase='verify_provisioning_permissions'
 const required=['datastore.databases.create','datastore.databases.get','firebaserules.rulesets.create','firebaserules.rulesets.get','firebaserules.rulesets.test','firebaserules.releases.create','firebaserules.releases.get','firebaserules.releases.update','storage.buckets.create','storage.buckets.get']
 const grantPermissions=['iam.roles.create','iam.roles.get','iam.roles.update','resourcemanager.projects.getIamPolicy','resourcemanager.projects.setIamPolicy']
 const iam=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${p}:testIamPermissions`,{method:'POST',body:{permissions:[...required,...grantPermissions]}})
 report.principal=credential.client_email
 report.iamAdministrationGranted=grantPermissions.filter(permission=>iam.permissions?.includes(permission))
 report.canApplyTemporaryCustomRole=grantPermissions.every(permission=>iam.permissions?.includes(permission))
 report.missingPermissions=required.filter(permission=>!iam.permissions?.includes(permission))
 if(report.missingPermissions.length)throw fail('QA_PROVISIONING_PERMISSIONS_MISSING')
 report.phase='create_qa_database'
 let database=await api(firestore+db,{allow404:true})
 if(!database){
  const op=await api(`${firestore}projects/${p}/databases?databaseId=${QA_RESOURCES.databaseId}`,{method:'POST',body:{locationId:QA_RESOURCES.location,type:'FIRESTORE_NATIVE',databaseEdition:'STANDARD',deleteProtectionState:'DELETE_PROTECTION_ENABLED'}})
  report.databaseCreated=true
  if(typeof op.name!=='string'||!op.name.startsWith(`projects/${p}/databases/${QA_RESOURCES.databaseId}/operations/`))throw fail('QA_DATABASE_OPERATION_MISMATCH')
  let complete=false
  for(let i=0;i<40;i++){
   const status=await api(firestore+op.name)
   if(status.error)throw fail('QA_DATABASE_CREATION_FAILED')
   if(status.done){complete=true;break}
   await wait(3000)
  }
  if(!complete)throw fail('QA_DATABASE_CREATION_PENDING')
  database=await api(firestore+db)
 }
 verifyQaDatabase(database);report.databaseVerified=true
 report.phase='deny_all_qa_client_access'
 const tests=['get','list','create','update','delete'].flatMap(method=>[undefined,{uid:'qa-client'}].map(auth=>({expectation:'DENY',request:{method,path:`/databases/${QA_RESOURCES.databaseId}/documents/qa/probe`,...(auth?{auth}:{})}})))
 const source={files:[{name:'firestore.rules',content:QA_DENY_RULES}]}
 const checked=await api(`${rules}projects/${p}:test`,{method:'POST',body:{source,testSuite:{testCases:tests}}})
 if(checked.testResults?.length!==tests.length||checked.testResults.some(t=>t.state!=='SUCCESS'))throw fail('QA_DENY_RULES_TEST_FAILED')
 const ruleset=await api(`${rules}projects/${p}/rulesets`,{method:'POST',body:{source}})
 if(!ruleset.name?.startsWith(`projects/${p}/rulesets/`))throw fail('QA_RULESET_IDENTITY_MISMATCH')
 const releaseName=`projects/${p}/releases/cloud.firestore/${QA_RESOURCES.databaseId}`
 const prior=await api(rules+releaseName,{allow404:true})
 if(prior)await api(rules+releaseName,{method:'PATCH',body:{release:{name:releaseName,rulesetName:ruleset.name},updateMask:'ruleset_name'}})
 else await api(`${rules}projects/${p}/releases`,{method:'POST',body:{name:releaseName,rulesetName:ruleset.name}})
 const release=await api(rules+releaseName),applied=await api(rules+release.rulesetName)
 if(release.rulesetName!==ruleset.name||applied.source?.files?.length!==1||applied.source.files[0].content!==QA_DENY_RULES)throw fail('QA_RULESET_READBACK_FAILED')
 report.clientRulesVerified=true
 report.phase='create_qa_bucket'
 const bucket=storage.bucket(QA_RESOURCES.bucket)
 let metadata
 try{[metadata]=await bucket.getMetadata()}catch(e){if(Number(e.code)!==404)throw e}
 if(!metadata){
  await storage.createBucket(QA_RESOURCES.bucket,{location:QA_RESOURCES.location,storageClass:'STANDARD',softDeletePolicy:{retentionDurationSeconds:'0'},versioning:{enabled:false},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},labels:{idogs_purpose:'deletion-qa',owner_approved:'2026-10-25'}})
  report.bucketCreated=true
  ;[metadata]=await bucket.getMetadata()
 }
 verifyQaBucket(metadata);report.bucketVerified=true
 report.phase='verify_default_resources_unchanged'
 const finalRules=await api(`${rules}projects/${p}/releases/cloud.firestore`,{allow404:true})
 if((finalRules?.rulesetName||null)!==(originalDefaultRules?.rulesetName||null))throw fail('DEFAULT_RULESET_CHANGED')
 const finalDb=await api(`${firestore}projects/${p}/databases/(default)`)
 for(const field of ['name','uid','locationId','type','databaseEdition','deleteProtectionState'])if(finalDb[field]!==originalDefaultDb[field])throw fail('DEFAULT_DATABASE_CHANGED')
 const [finalBucket]=await storage.bucket(`${p}.firebasestorage.app`).getMetadata()
 for(const key of ['metageneration','softDeletePolicy','versioning','retentionPolicy','cors','iamConfiguration'])if(JSON.stringify(finalBucket[key])!==JSON.stringify(defaultMetadata[key]))throw fail('DEFAULT_BUCKET_CHANGED')
 return {...report,status:'qa_resources_verified',defaultResourcesUnchanged:true,location:QA_RESOURCES.location,softDeleteSeconds:0,permanentDeletionQaPassed:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report={}
 try{
  const result=await provisionQaResources({report,loadClients:async credential=>{
   const [{cert},{Storage}]=await Promise.all([import('firebase-admin/app'),import('@google-cloud/storage')])
   const auth=cert(credential),storage=new Storage({projectId:QA_RESOURCES.projectId,credentials:credential})
   return {storage,wait:ms=>new Promise(r=>setTimeout(r,ms)),api:async(url,{method='GET',body,allow404=false}={})=>{
    const token=await auth.getAccessToken()
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
    if(allow404&&response.status===404)return null
    if(!response.ok){
     const error=await response.json().catch(()=>({}))
     const permission=String(error.error?.message||'').match(/Permission ['"]([A-Za-z0-9_.]+)['"]/)?.[1]
     const detail=error.error?.details?.find(d=>d['@type']==='type.googleapis.com/google.rpc.ErrorInfo')
     throw Object.assign(new Error('QA_RESOURCE_API_FAILED'),{code:'QA_RESOURCE_API_FAILED',httpStatus:response.status,permission,reason:/^[A-Z_]{1,80}$/.test(detail?.reason||'')?detail.reason:undefined})
    }
    return response.json()
   }}
  }})
  console.log(JSON.stringify(result,null,2))
 }catch(e){console.error(JSON.stringify({...report,status:'blocked',code:/^[A-Z_]{3,80}$/.test(String(e.code))?e.code:'QA_RESOURCE_PROVISIONING_FAILED',httpStatus:e.httpStatus,permission:e.permission,reason:e.reason,partialResourcesMayExist:report.databaseCreated===true||report.bucketCreated===true}));process.exitCode=2}
}
