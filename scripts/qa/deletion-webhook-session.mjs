import {randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {stagingDeletionConfiguration} from './deletion-staging-readiness.mjs'
const P='prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o',T='team_oZF1Z0BUEceb9fAXdmFV1Saz',B='release/ios-app-store-20261025'
const keys=['IDOGS_DELETION_STRIPE_TEST_KEY','IDOGS_DELETION_WEBHOOK_SECRET','IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT']
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
export function sessionConfiguration(env){
 ensure(env.IDOGS_WEBHOOK_QA_APPROVAL==='2026-10-26-staging-preview-webhook','WEBHOOK_QA_APPROVAL_REQUIRED')
 ensure(env.GITHUB_REPOSITORY==='izipawsltd-Tony/idogs-app'&&env.GITHUB_REF_NAME===B&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'WEBHOOK_QA_SOURCE_REQUIRED')
 ensure(!!env.VERCEL_TOKEN,'VERCEL_TOKEN_REQUIRED')
 const config=stagingDeletionConfiguration(env);ensure(config.status==='configured','STAGING_CONFIG_REQUIRED')
 ensure(/^re_[A-Za-z0-9_-]+$/.test(env.IDOGS_DELETION_RESEND_QA_KEY||''),'DELETION_RESEND_QA_KEY_REQUIRED')
 return config
}
export async function webhookSession({env=process.env,loadClients,runFixture,wait=ms=>new Promise(r=>setTimeout(r,ms)),report={}}){
 const config=sessionConfiguration(env),{stripe,api}=await loadClients(config)
 let endpoint,bypass,deployment,originalProject,mutated=false
 const createdEnvs=[],cleanup=[]
 const note=`idogs-deletion-qa-${randomBytes(12).toString('hex')}`
 report.source=env.GITHUB_SHA;report.project=P;report.branch=B
 try{
  report.phase='verify_staging_project'
  originalProject=await api(`/v9/projects/${P}`)
  ensure(originalProject.id===P&&originalProject.name==='idogs-app-staging'&&originalProject.accountId===T&&originalProject.link?.org==='izipawsltd-Tony'&&originalProject.link?.repo==='idogs-app','VERCEL_PROJECT_IDENTITY_MISMATCH')
  ensure((await stripe.accounts.retrieve()).id==='acct_1TiU0IGHgBd6ZgJE','STRIPE_ACCOUNT_MISMATCH')
  const initial=(await api(`/v10/projects/${P}/env`)).envs||[]
  ensure(!initial.some(e=>e.gitBranch===B&&e.target?.includes('preview')&&keys.includes(e.key)),'QA_BRANCH_ENV_ALREADY_EXISTS')
  report.phase='create_then_disable_test_endpoint'
  endpoint=await stripe.webhookEndpoints.create({url:'https://idogs-app-staging-yeh5jvxgo-izipawsltd-tonys-projects.vercel.app/api/qa/deletion-webhook',enabled_events:['customer.subscription.updated'],description:note,metadata:{deletionQaSession:note}})
  ensure(endpoint.livemode===false&&/^we_[A-Za-z0-9]+$/.test(endpoint.id)&&/^whsec_[A-Za-z0-9]+$/.test(endpoint.secret||''),'QA_ENDPOINT_CONFIGURATION_MISMATCH')
  await stripe.webhookEndpoints.update(endpoint.id,{disabled:true})
  ensure((await stripe.webhookEndpoints.retrieve(endpoint.id)).status==='disabled','QA_ENDPOINT_DISABLE_FAILED')
  report.endpointCreated=true
  report.phase='create_temporary_bypass'
  bypass=randomBytes(32).toString('hex');mutated=true
  await api(`/v1/projects/${P}/protection-bypass`,{method:'PATCH',body:{generate:{secret:bypass,note}}})
  ensure((await api(`/v9/projects/${P}`)).protectionBypass?.[bypass],'QA_BYPASS_READBACK_FAILED')
  report.bypassCreated=true
  report.phase='create_branch_only_variables'
  const values=[config.stripeKey,endpoint.secret,new Date(Date.now()+23*3600000).toISOString()]
  for(let i=0;i<keys.length;i++){
   await api(`/v10/projects/${P}/env`,{method:'POST',body:{key:keys[i],value:values[i],type:i===2?'plain':'sensitive',target:['preview'],gitBranch:B,comment:note}})
   const match=((await api(`/v10/projects/${P}/env`)).envs||[]).filter(e=>e.key===keys[i]&&e.gitBranch===B&&e.target?.length===1&&e.target[0]==='preview'&&e.comment===note)
   ensure(match.length===1,'QA_ENV_READBACK_FAILED');createdEnvs.push(match[0].id)
  }
  report.phase='deploy_exact_preview_source'
  deployment=await api('/v13/deployments',{method:'POST',body:{name:'idogs-app-staging',project:P,gitSource:{type:'github',repoId:originalProject.link.repoId,ref:B,sha:env.GITHUB_SHA},meta:{deletionQaSession:note}}})
  ensure(/^dpl_[A-Za-z0-9]+$/.test(deployment.id||''),'QA_DEPLOYMENT_ID_REQUIRED')
  for(let attempt=0;attempt<90;attempt++){
   deployment=await api(`/v13/deployments/${deployment.id}`)
   ensure(!['ERROR','CANCELED'].includes(deployment.readyState),'QA_PREVIEW_BUILD_FAILED')
   if(deployment.readyState==='READY')break
   await wait(5000)
  }
  ensure(deployment.readyState==='READY'&&deployment.projectId===P&&deployment.target!=='production'&&deployment.meta?.githubCommitSha===env.GITHUB_SHA&&deployment.meta?.githubCommitRef===B&&/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url||''),'QA_PREVIEW_IDENTITY_MISMATCH')
  report.previewReady=true;report.deploymentId=deployment.id
  report.phase='enable_dedicated_test_receiver'
  const url=`https://${deployment.url}/api/qa/deletion-webhook?x-vercel-protection-bypass=${encodeURIComponent(bypass)}`
  // The URL carrying bypass credentials must never be logged or saved.
  await stripe.webhookEndpoints.update(endpoint.id,{url,disabled:false})
  const active=await stripe.webhookEndpoints.retrieve(endpoint.id)
  ensure(active.url===url&&active.status==='enabled'&&active.livemode===false&&active.metadata?.deletionQaSession===note,'QA_ENDPOINT_READBACK_FAILED')
  report.phase='run_signed_provider_fixture'
  report.fixture=await runFixture({...env,IDOGS_DELETION_SIGNED_WEBHOOK_QA_REQUIRED:'true'})
  ensure(report.fixture?.status==='isolated_cloud_permanent_deletion_pass'&&report.fixture?.signedWebhookVerified===true&&report.fixture?.cleanupVerified===true,'QA_SIGNED_FIXTURE_FAILED')
  report.status='signed_webhook_qa_pass'
 }finally{
  const clean=async(step,fn)=>{try{await fn();cleanup.push({step,status:'success'})}catch(e){cleanup.push({step,status:'failed',code:/^[A-Za-z0-9_/-]{1,80}$/.test(String(e.code||''))?String(e.code):'CLEANUP_FAILED'})}}
  if(endpoint)await clean('test_endpoint',async()=>{const current=await stripe.webhookEndpoints.retrieve(endpoint.id);ensure(current.livemode===false&&current.metadata?.deletionQaSession===note,'QA_ENDPOINT_CLEANUP_BINDING');await stripe.webhookEndpoints.del(endpoint.id)})
  if(bypass&&mutated)await clean('temporary_bypass',async()=>{const p=await api(`/v9/projects/${P}`);if(p.protectionBypass?.[bypass])await api(`/v1/projects/${P}/protection-bypass`,{method:'PATCH',body:{revoke:{secret:bypass,regenerate:false}}});ensure(!(await api(`/v9/projects/${P}`)).protectionBypass?.[bypass],'QA_BYPASS_REVOCATION_UNCONFIRMED')})
  // Reconcile writes whose API response may have been lost before an ID was saved.
  if(mutated)await clean('reconcile_branch_variable_ids',async()=>{for(const e of (await api(`/v10/projects/${P}/env`)).envs||[])if(e.comment===note&&e.gitBranch===B&&e.target?.length===1&&e.target[0]==='preview'&&keys.includes(e.key)&&!createdEnvs.includes(e.id))createdEnvs.push(e.id)})
  for(const id of createdEnvs)await clean('branch_variable',async()=>{const all=(await api(`/v10/projects/${P}/env`)).envs||[],e=all.find(x=>x.id===id);ensure(e?.comment===note&&e.gitBranch===B&&e.target?.length===1&&e.target[0]==='preview'&&keys.includes(e.key),'QA_ENV_CLEANUP_BINDING');await api(`/v9/projects/${P}/env/${id}`,{method:'DELETE'})})
  if(deployment?.id)await clean('temporary_deployment',async()=>{const d=await api(`/v13/deployments/${deployment.id}`);ensure(d.projectId===P&&d.meta?.githubCommitSha===env.GITHUB_SHA&&d.target!=='production','QA_DEPLOYMENT_CLEANUP_BINDING');await api(`/v13/deployments/${deployment.id}`,{method:'DELETE'})})
  if(originalProject)await clean('protection_settings_unchanged',async()=>{const p=await api(`/v9/projects/${P}`);for(const key of ['ssoProtection','passwordProtection'])ensure(JSON.stringify(p[key])===JSON.stringify(originalProject[key]),'QA_PROTECTION_SETTINGS_CHANGED')})
  report.sessionCleanup=cleanup;report.sessionCleanupVerified=cleanup.every(c=>c.status==='success')
  if(!report.sessionCleanupVerified)throw Object.assign(new Error('QA_SESSION_CLEANUP_FAILED'),{code:'QA_SESSION_CLEANUP_FAILED'})
 }
 return report
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report={status:'blocked'}
 try{
  await webhookSession({report,loadClients:async config=>{
   const {default:Stripe}=await import('stripe'),stripe=new Stripe(config.stripeKey,{timeout:20000,maxNetworkRetries:0})
   return {stripe,api:async(path,{method='GET',body}={})=>{
    const r=await fetch(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}teamId=${T}`,{method,headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
    if(!r.ok)throw Object.assign(new Error('QA_VERCEL_API_FAILED'),{code:`QA_VERCEL_HTTP_${r.status}`})
    return r.status===204?{}:r.json()
   }}
  },runFixture:async env=>{
   const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/qa/deletion-cloud-permanent.mjs'],{env,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',b=>{stdout+=b;if(stdout.length>200000)child.kill()});child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>resolve({code,stdout}))})
   let parsed;try{parsed=JSON.parse(result.stdout)}catch{throw Object.assign(new Error('QA_FIXTURE_REPORT_INVALID'),{code:'QA_FIXTURE_REPORT_INVALID'})}
   if(result.code!==0)report.fixture=parsed
   return parsed
  }})
 }catch(e){report.status='blocked';report.code=/^[A-Za-z0-9_/-]{1,100}$/.test(String(e.code||''))?String(e.code):'QA_WEBHOOK_SESSION_FAILED'}
 console.log(JSON.stringify(report,null,2));if(report.status!=='signed_webhook_qa_pass')process.exitCode=2
}
