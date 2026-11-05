import { pathToFileURL } from 'node:url'
const fail=code=>Object.assign(new Error(code),{code})
export const STAGING_DELETION_TARGET=Object.freeze({projectId:'idogs-app-staging',bucket:'idogs-app-staging.firebasestorage.app',stripeAccount:'acct_1TiU0IGHgBd6ZgJE'})

// Read-only prerequisite inspection. This script never creates fixtures, changes
// subscriptions, reads customer records, grants claims or deletes anything.
export function stagingDeletionConfiguration(env){
  const missing=[]
  if(!env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON)missing.push('IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON')
  if(!env.IDOGS_DELETION_STRIPE_TEST_KEY)missing.push('IDOGS_DELETION_STRIPE_TEST_KEY')
  if(missing.length)return {status:'blocked',code:'STAGING_CREDENTIALS_MISSING',missing}
  for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])if(env[key])throw fail('STAGING_ENDPOINT_OVERRIDE')
  let credential
  try{credential=JSON.parse(env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON)}catch{throw fail('STAGING_CREDENTIAL_INVALID')}
  if(credential.project_id!==STAGING_DELETION_TARGET.projectId||credential.type!=='service_account'||typeof credential.private_key!=='string'||!credential.private_key.startsWith('-----BEGIN PRIVATE KEY-----')||typeof credential.client_email!=='string'||!credential.client_email.endsWith('@idogs-app-staging.iam.gserviceaccount.com'))throw fail('STAGING_CREDENTIAL_TARGET_MISMATCH')
  if(!/^(rk|sk)_test_[A-Za-z0-9]+$/.test(env.IDOGS_DELETION_STRIPE_TEST_KEY))throw fail('STRIPE_TEST_KEY_REQUIRED')
  return {status:'configured',credential,stripeKey:env.IDOGS_DELETION_STRIPE_TEST_KEY}
}

export async function checkStagingDeletionReadiness({env=process.env,loadClients}){
  const config=stagingDeletionConfiguration(env)
  if(config.status==='blocked')return config
  const clients=await loadClients(config)
  if(clients.projectId!==STAGING_DELETION_TARGET.projectId||clients.bucket.name!==STAGING_DELETION_TARGET.bucket)throw fail('STAGING_CLIENT_TARGET_MISMATCH')
  const [account]=await Promise.all([clients.stripe.accounts.retrieve(),clients.firestoreProbe(),clients.authProbe()])
  if(account.id!==STAGING_DELETION_TARGET.stripeAccount)throw fail('STRIPE_ACCOUNT_MISMATCH')
  const [metadata]=await clients.bucket.getMetadata()
  if(metadata.name!==STAGING_DELETION_TARGET.bucket||typeof metadata.location!=='string'||!metadata.location)throw fail('STAGING_BUCKET_MISMATCH')
  // Read test-mode subscription capability without returning IDs or contents.
  const list=await clients.stripe.subscriptions.list({limit:1,status:'all'})
  if(!Array.isArray(list.data)||list.data.some(item=>item.livemode!==false))throw fail('STRIPE_TEST_MODE_UNCONFIRMED')
  return {status:'read_access_verified',...STAGING_DELETION_TARGET,storageLocation:metadata.location,
    storageProjectNumber:metadata.projectNumber?String(metadata.projectNumber):null,
    storageSoftDeleteSeconds:metadata.softDeletePolicy?.retentionDurationSeconds===undefined?null:String(metadata.softDeletePolicy.retentionDurationSeconds),
    permanentDeletionReady:false,renewalWriteVerified:false,
    remaining:['disposable_fixture_binding','staging_worker_and_ingress_controls','stripe_test_renewal_write_and_webhook_readback','provider_recovery_inventory','post_auth_confirmation_delivery']}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await checkStagingDeletionReadiness({loadClients:async config=>{
      const [{initializeApp,cert},{getAuth},{getFirestore},{getStorage},{default:Stripe}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/auth'),import('firebase-admin/firestore'),import('firebase-admin/storage'),import('stripe')])
      const app=initializeApp({credential:cert(config.credential),projectId:STAGING_DELETION_TARGET.projectId,storageBucket:STAGING_DELETION_TARGET.bucket},'deletion-staging-readiness')
      const db=getFirestore(app),auth=getAuth(app)
      return {projectId:app.options.projectId,bucket:getStorage(app).bucket(),stripe:new Stripe(config.stripeKey,{timeout:15000,maxNetworkRetries:0}),
        firestoreProbe:()=>db.doc('_qaReadiness/deletion-connection-probe').get(),
        authProbe:async()=>{try{await auth.getUser('idogs-deletion-readiness-probe')}catch(e){if(e.code!=='auth/user-not-found')throw e}}}
    }})
    console.log(JSON.stringify(result,null,2))
    if(result.status==='blocked')process.exitCode=2
  }catch(e){
    const codes=new Set(['STAGING_ENDPOINT_OVERRIDE','STAGING_CREDENTIAL_INVALID','STAGING_CREDENTIAL_TARGET_MISMATCH','STRIPE_TEST_KEY_REQUIRED','STAGING_CLIENT_TARGET_MISMATCH','STRIPE_ACCOUNT_MISMATCH','STAGING_BUCKET_MISMATCH','STRIPE_TEST_MODE_UNCONFIRMED'])
    console.error(JSON.stringify({status:'blocked',code:codes.has(e.code)?e.code:'STAGING_READ_ACCESS_FAILED'}))
    process.exitCode=2
  }
}
