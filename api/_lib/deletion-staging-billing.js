import { createStripeDeletionRenewalContract } from './deletion-stripe-contract.js'
import { stopVerifiedDeletionRenewals } from './deletion-billing.js'
import { randomUUID } from 'node:crypto'

const fail=code=>Object.assign(new Error(code),{code})
// Operator-only fixture harness dependency, never imported by a deployed route.
// No general cloud deletion processor or live billing adapter is enabled here.
export function createStagingDeletionBilling({db,stripe,projectId,stripeKey,runId,env=process.env}){
  function guard(){
    if(projectId!=='idogs-app-staging'||db.projectId!==projectId||!/^deletion-qa-[a-f0-9]{32}$/.test(runId||'')||!/^(rk|sk)_test_[A-Za-z0-9]+$/.test(stripeKey||''))throw fail('STAGING_BILLING_TARGET_REQUIRED')
    for(const k of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])if(env[k])throw fail('STAGING_BILLING_ENDPOINT_OVERRIDE')
  }
  guard()
  const uid=`qa-${runId}`
  async function binding(targetUid){
    guard()
    if(targetUid!==uid)throw fail('STAGING_FIXTURE_UID_REQUIRED')
    const [fixture,profile]=await Promise.all([db.doc(`deletionQaFixtures/${runId}`).get(),db.doc(`users/${uid}`).get()])
    const f=fixture.data(),p=profile.data()
    if(!fixture.exists||!profile.exists||f.runId!==runId||f.uid!==uid||f.disposable!==true||p.deletionQaRunId!==runId||p.stripeCustomerId!==f.stripeCustomerId||!/^cus_[A-Za-z0-9]+$/.test(f.stripeCustomerId||''))throw fail('STAGING_FIXTURE_BINDING_REQUIRED')
    const customer=await stripe.customers.retrieve(f.stripeCustomerId)
    if(customer.deleted||customer.id!==f.stripeCustomerId||customer.livemode!==false||customer.metadata?.deletionQaRunId!==runId||customer.metadata?.firebaseUid!==uid)throw fail('STAGING_CUSTOMER_BINDING_REQUIRED')
    const owners=await db.collection('users').where('stripeCustomerId','==',f.stripeCustomerId).limit(2).get()
    if(owners.docs.length!==1||owners.docs[0].id!==uid)throw fail('STAGING_SHARED_CUSTOMER_REJECTED')
    return {customerId:f.stripeCustomerId,ownerUids:[uid],knownSubscriptionIds:[p.stripeSubscriptionId,p.smsSubscriptionId].filter(Boolean)}
  }
  const provider=createStripeDeletionRenewalContract({stripe,loadOwnership:binding,assertRuntime:guard,expectedAccountId:'acct_1TiU0IGHgBd6ZgJE',expectedLivemode:false})
  async function accept({uid:targetUid,revision}){
    await binding(targetUid)
    if(!Number.isSafeInteger(revision)||revision<1)throw fail('STAGING_REQUEST_REVISION_REQUIRED')
    const ref=db.doc(`accountDeletionRequests/${uid}`),epoch=randomUUID()
    const accepted=await db.runTransaction(async tx=>{
      const snap=await tx.get(ref)
      if(!snap.exists||snap.data().revision!==revision||!['requested','review_required','cancelled'].includes(snap.data().status))return false
      tx.update(ref,{billingCheckEpoch:epoch,renewalStatus:'pending_verification'});return true
    })
    if(!accepted)throw fail('STAGING_REQUEST_MISMATCH')
    let outcome
    try{outcome=await stopVerifiedDeletionRenewals({uid,revision,provider})}
    catch(e){outcome={renewalStatus:'review_required'};await save(outcome);throw e}
    await save(outcome)
    return outcome
    async function save(result){
      guard()
      await db.runTransaction(async tx=>{
        const latest=await tx.get(ref),task=db.doc(`accountDeletionRenewalTasks/${uid}_${revision}`),taskSnap=await tx.get(task)
        if(!latest.exists||latest.data().revision!==revision||latest.data().billingCheckEpoch!==epoch||!['requested','review_required','cancelled'].includes(latest.data().status))throw fail('STAGING_REQUEST_CHANGED')
        const updatedAt=new Date().toISOString()
        tx.update(ref,{...result,renewalCheckedAt:updatedAt})
        if(taskSnap.exists)tx.update(task,{status:result.renewalStatus,updatedAt,verificationMode:'staging-stripe-test',executionEnabled:false})
      })
    }
  }
  return {uid,accept,mode:'staging-stripe-test',assertRuntime:guard}
}
