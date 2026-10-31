import test from 'node:test'
import assert from 'node:assert/strict'
import {createStagingDeletionBilling} from '../api/_lib/deletion-staging-billing.js'
const runId='deletion-qa-'+'a'.repeat(32)
const args=()=>({db:{projectId:'idogs-app-staging',doc:()=>assert.fail('unexpected IO')},projectId:'idogs-app-staging',stripeKey:'rk_test_Synthetic',stripe:{},runId,env:{}})
test('staging-only billing rejects production, live credentials and missing run scope',()=>{
 for(const change of [{projectId:'idogs-app'},{stripeKey:'sk_live_Synthetic'},{runId:'arbitrary'},{db:{projectId:'idogs-app'}}])assert.throws(()=>createStagingDeletionBilling({...args(),...change}),/STAGING_BILLING_TARGET_REQUIRED/)
})
test('stage fixture adapter does not mutate SDK on construction or support arbitrary UIDs',async()=>{
 const b=createStagingDeletionBilling(args())
 assert.equal(b.mode,'staging-stripe-test')
 await assert.rejects(b.accept({uid:'customer-user',revision:1}),/STAGING_FIXTURE_UID_REQUIRED/)
})
test('endpoint override fails before any database or Stripe access',()=>{
 assert.throws(()=>createStagingDeletionBilling({...args(),env:{FIRESTORE_EMULATOR_HOST:'localhost:8080'}}),/STAGING_BILLING_ENDPOINT_OVERRIDE/)
})
test('missing disposable fixture binding rejects before Stripe access',async()=>{
 const a=args();a.db.doc=()=>({get:async()=>({exists:false,data:()=>undefined})})
 await assert.rejects(createStagingDeletionBilling(a).accept({uid:`qa-${runId}`,revision:1}),/STAGING_FIXTURE_BINDING_REQUIRED/)
})
