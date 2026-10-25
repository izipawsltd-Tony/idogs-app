import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sessionConfiguration,webhookSession} from './qa/deletion-webhook-session.mjs'
const P='prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o',B='release/ios-app-store-20261025'
const env={IDOGS_WEBHOOK_QA_APPROVAL:'2026-10-26-staging-preview-webhook',GITHUB_REPOSITORY:'izipawsltd-Tony/idogs-app',GITHUB_REF_NAME:B,GITHUB_SHA:'a'.repeat(40),VERCEL_TOKEN:'fixture',IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'idogs-app-staging',client_email:'fixture@idogs-app-staging.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----fixture'}),IDOGS_DELETION_STRIPE_TEST_KEY:'sk_test_fixture',IDOGS_DELETION_RESEND_QA_KEY:'re_fixture'}
function clients(){
 const project={id:P,name:'idogs-app-staging',accountId:'team_oZF1Z0BUEceb9fAXdmFV1Saz',link:{org:'izipawsltd-Tony',repo:'idogs-app',repoId:1},ssoProtection:{enabled:true},passwordProtection:{enabled:true},protectionBypass:{}}
 let endpoint,deletedEndpoint=false,deletedDeployment=false;const envs=[],writes=[]
 const stripe={accounts:{retrieve:async()=>({id:'acct_1TiU0IGHgBd6ZgJE'})},webhookEndpoints:{create:async body=>{endpoint={...body,id:'we_fixture',livemode:false,status:'enabled',secret:'whsec_fixture'};return {...endpoint}},update:async(id,body)=>{assert.equal(id,'we_fixture');Object.assign(endpoint,body);endpoint.status=body.disabled?'disabled':'enabled';return endpoint},retrieve:async()=>endpoint,del:async()=>{deletedEndpoint=true}}}
 const deployment={id:'dpl_fixture',readyState:'READY',projectId:P,url:'qa-fixture.vercel.app',target:null,meta:{githubCommitSha:env.GITHUB_SHA,githubCommitRef:B}}
 const api=async(path,{method='GET',body}={})=>{
  if(method!=='GET')writes.push({path,method})
  if(path===`/v9/projects/${P}`)return project
  if(path.endsWith('/protection-bypass')){if(body.generate)project.protectionBypass[body.generate.secret]={note:body.generate.note};else delete project.protectionBypass[body.revoke.secret];return {}}
  if(path===`/v10/projects/${P}/env`){if(method==='POST')envs.push({...body,id:`env_${envs.length}`});return {envs}}
  if(path.startsWith(`/v9/projects/${P}/env/`)){const id=path.split('/').at(-1),index=envs.findIndex(e=>e.id===id);envs.splice(index,1);return {}}
  if(path==='/v13/deployments'){assert.equal(body.project,P);assert.equal(body.target,undefined);assert.equal(body.gitSource.sha,env.GITHUB_SHA);return deployment}
  if(path==='/v13/deployments/dpl_fixture'){if(method==='DELETE')deletedDeployment=true;return deployment}
  throw Error('Unexpected fixture path')
 }
 return {project,envs,writes,loadClients:async()=>({stripe,api}),counts:()=>({deletedEndpoint,deletedDeployment,bypasses:Object.keys(project.protectionBypass).length,envs:envs.length})}
}
test('missing authority/source/token prevents any SDK initialization',async()=>{
 for(const patch of [{IDOGS_WEBHOOK_QA_APPROVAL:''},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF_NAME:'main'},{VERCEL_TOKEN:''},{IDOGS_DELETION_STRIPE_TEST_KEY:'sk_live_fixture'}]){
  let loaded=false;await assert.rejects(webhookSession({env:{...env,...patch},loadClients:async()=>{loaded=true}}));assert.equal(loaded,false)
 }
 assert.ok(sessionConfiguration(env))
})
test('complete session pins source, creates only new branch envs and removes all temporary access',async()=>{
 const f=clients(),report={}
 await webhookSession({env,...f,report,runFixture:async()=>({status:'isolated_cloud_permanent_deletion_pass',signedWebhookVerified:true,cleanupVerified:true})})
 assert.equal(report.status,'signed_webhook_qa_pass');assert.equal(report.sessionCleanupVerified,true)
 assert.deepEqual(f.counts(),{deletedEndpoint:true,deletedDeployment:true,bypasses:0,envs:0})
 assert.deepEqual(f.project.ssoProtection,{enabled:true})
})
test('fixture failure still revokes bypass, deletes endpoint and removes branch variables',async()=>{
 const f=clients(),report={}
 await assert.rejects(webhookSession({env,...f,report,runFixture:async()=>({status:'blocked',signedWebhookVerified:false,cleanupVerified:true})}),/SIGNED_FIXTURE_FAILED/)
 assert.equal(report.sessionCleanupVerified,true);assert.deepEqual(f.counts(),{deletedEndpoint:true,deletedDeployment:true,bypasses:0,envs:0})
})
test('existing branch credential is never overwritten and no new resource is created',async()=>{
 const f=clients();f.envs.push({key:'IDOGS_DELETION_WEBHOOK_SECRET',target:['preview'],gitBranch:B,id:'foreign'})
 await assert.rejects(webhookSession({env,...f,runFixture:async()=>{throw Error('must not run')}}),/ALREADY_EXISTS/)
 assert.equal(f.writes.length,0);assert.equal(f.envs[0].id,'foreign')
})
