import {getApps,initializeApp,cert} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {getAuth} from 'firebase-admin/auth'
import {assertDeletionQaHttpRuntime,makePublicDeletionQaHandler} from '../_lib/deletion-qa-http.js'
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store')
 try{
  const env=process.env,assertRuntime=()=>assertDeletionQaHttpRuntime(env);assertRuntime()
  const name='idogs-deletion-http-qa',app=getApps().find(a=>a.name===name)||initializeApp({projectId:env.FIREBASE_PROJECT_ID,credential:cert({projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')})},name)
  return await makePublicDeletionQaHandler({db:getFirestore(app,'idogs-deletion-qa'),auth:getAuth(app),assertRuntime})(req,res)
 }catch{return res.status(503).json({error:'Isolated QA unavailable'})}
}
