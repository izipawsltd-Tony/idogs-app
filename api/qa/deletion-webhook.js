import Stripe from 'stripe'
import {getApps,initializeApp,cert} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {assertDeletionQaWebhookRuntime,makeDeletionQaWebhook} from '../_lib/deletion-qa-webhook.js'
export const config={api:{bodyParser:false}}
// Explicit deletion control exemption: fixed isolated database, signed Test
// fixture receipts only; runtime rejects Production and all other projects.
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store')
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
 try{
  const env=process.env,assertRuntime=()=>assertDeletionQaWebhookRuntime(env)
  assertRuntime()
  const name='idogs-deletion-webhook-qa'
  const app=getApps().find(a=>a.name===name)||initializeApp({projectId:env.FIREBASE_PROJECT_ID,credential:cert({projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')})},name)
  const db=getFirestore(app,'idogs-deletion-qa'),stripe=new Stripe(env.IDOGS_DELETION_STRIPE_TEST_KEY,{timeout:15000,maxNetworkRetries:0})
  let size=0;const chunks=[]
  for await(const chunk of req){size+=chunk.length;if(size>262144)return res.status(413).json({error:'Webhook too large'});chunks.push(chunk)}
  const result=await makeDeletionQaWebhook({db,stripe,secret:env.IDOGS_DELETION_WEBHOOK_SECRET,assertRuntime})(Buffer.concat(chunks),req.headers['stripe-signature'])
  return res.status(result.status).json(result.body)
 }catch(e){return res.status(e.status||503).json({error:'Isolated QA webhook unavailable'})}
}
