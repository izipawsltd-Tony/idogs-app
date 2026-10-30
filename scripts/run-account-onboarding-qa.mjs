import { createServer } from 'node:http'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createServer as createViteServer } from 'vite'
import { makeOnboardingHandler, passwordVerifier, verifyAccountToken } from '../api/_lib/account-onboarding.js'
import { createPuppyUpdatesHandler } from '../api/_lib/puppy-updates-handler.js'
const projectId='demo-idogs-account-onboarding'
if(process.env.GCLOUD_PROJECT!==projectId||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9399'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:9380')throw new Error('Isolated demo required')
process.env.IDOGS_ACCOUNT_ONBOARDING_GATE='1'
const app=initializeApp({projectId}),auth=getAuth(app),db=getFirestore(app),uid='onboarding-demo'
try{await auth.getUser(uid)}catch(err){if(err.code!=='auth/user-not-found')throw err;await auth.createUser({uid,phoneNumber:'+61400000601'})}
await db.doc(`users/${uid}`).set({firstName:'QA',lastName:'Phone customer',email:'',role:'breeder',kennelName:'Synthetic QA',plan:'plus',stripeCustomerId:'cus_synthetic_unchanged',subscriptionStatus:'active'})
await db.doc('dogs/onboarding-demo-dog').set({tenantId:uid,currentOwnerId:uid,name:'Ruby demo',breed:'Toy Poodle',sex:'female',dob:'2026-10-01',status:'active',passportId:'ONBOARDING-DEMO'})
await db.doc('puppyProfiles/onboarding-demo-dog').set({ownerId:uid,publicEnabled:true})
for(const audience of ['public','internal'])await db.doc(`puppyProfiles/onboarding-demo-dog/updates/${audience}`).set({authorUid:uid,sourceDogId:'onboarding-demo-dog',text:audience==='public'?'Ruby is enjoying the garden':'Private breeder note',audience,date:'2026-10-31',createdAt:'2026-10-31T00:00:00Z',media:[]})
Object.assign(process.env,{VITE_ACCOUNT_ONBOARDING_QA:'1',VITE_FIREBASE_API_KEY:'emulator-key',VITE_FIREBASE_AUTH_DOMAIN:'localhost',VITE_FIREBASE_PROJECT_ID:projectId,VITE_FIREBASE_APP_ID:'demo-onboarding'})
const handler=makeOnboardingHandler({auth,db,verifyPassword:passwordVerifier({apiKey:'emulator-key'})})
const passport=(await import('../api/passport.js')).default
const puppyUpdates=createPuppyUpdatesHandler({db,verifyToken:token=>verifyAccountToken(token,auth,db),sign:async()=>[]})
const vite=await createViteServer({server:{middlewareMode:true,hmr:{host:'127.0.0.1',port:24994}},appType:'spa'})
const server=createServer(async(req,res)=>{
  if(!req.url?.startsWith('/api/'))return vite.middlewares(req,res)
  res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res}
  res.setHeader('Cache-Control','private, no-store')
  if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5194')return res.status(403).json({error:'Use the local QA origin.'})
  try{
    req.query=Object.fromEntries(new URL(req.url,'http://127.0.0.1:5194').searchParams)
    let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2048)return res.status(413).json({error:'Too large'})}req.body=text
    if(req.url==='/api/account-onboarding')return handler(req,res)
    if(req.url==='/api/auth-options')return res.json({providers:[],phone:false})
    if(req.url==='/api/qa-onboarding/start'&&req.method==='POST')return res.json({token:await auth.createCustomToken(uid)})
    const token=(req.headers.authorization||'').replace(/^Bearer /,'')
    if(req.url==='/api/qa-onboarding/mailbox'&&req.method==='GET'){
      const identity=await auth.verifyIdToken(token,true);if(identity.uid!==uid)throw new Error()
      const user=await auth.getUser(uid),inbox=await(await fetch(`http://127.0.0.1:9399/emulator/v1/projects/${projectId}/oobCodes`)).json()
      return res.json({messages:inbox.oobCodes.filter(c=>c.email===user.email).map(c=>({label:c.requestType==='PASSWORD_RESET'?'Reset test password':'Verify test email',url:c.oobLink}))})
    }
    if(req.url==='/api/qa-onboarding/manage'&&req.method==='GET'){
      const identity=await verifyAccountToken(token,auth,db);if(identity.uid!==uid)throw new Error()
      return res.json({dogName:(await db.doc('dogs/onboarding-demo-dog').get()).data().name,plan:(await db.doc(`users/${uid}`).get()).data().plan})
    }
    if(req.url?.startsWith('/api/passport?'))return await passport(req,res)
    if(req.url?.split('?')[0]==='/api/puppy-updates')return await puppyUpdates(req,res)
    return res.status(503).json({error:'Not part of this isolated QA.'})
  }catch{return res.status(403).json({error:'Finish account setup before using this action.'})}
})
await new Promise(resolve=>server.listen(5194,'127.0.0.1',resolve))
console.log('Onboarding QA: http://127.0.0.1:5194/qa/onboarding — synthetic accounts only.')
async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await vite.close();await db.terminate();process.exit(0)}
process.once('SIGINT',stop);process.once('SIGTERM',stop)
