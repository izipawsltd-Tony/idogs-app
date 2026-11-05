import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { DELETION_COLLECTION } from '../_lib/account-deletion.js'
import { buildDeletionInventory } from '../_lib/account-deletion-inventory.js'
import { getApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { requireDeletionEmulators } from '../_lib/deletion-fence.js'
import { createEmulatorDeletionProcessor } from '../_lib/deletion-processor.js'
import { syntheticDeletionProvider } from '../_lib/deletion-synthetic-provider.js'
import { makeDeletionProcessingHandler } from '../_lib/deletion-processing-handler.js'

async function prototypeContext(req,res) {
  try {
    const projectId=getApp().options.projectId,db=getFirestore(),auth=getAuth(),bucket=getStorage().bucket(`${projectId}.firebasestorage.app`)
    requireDeletionEmulators({projectId,db,auth,bucket})
    const header=req.headers.authorization||''
    const token=header.startsWith('Bearer ')?await auth.verifyIdToken(header.slice(7),true):null
    if(token?.deletionPrototypeOperator!==true){res.status(403).json({error:'Synthetic deletion operator required'});return null}
    return {projectId,db,auth,bucket,token}
  }catch{res.status(503).json({error:'Permanent processing is available only in the local synthetic prototype.'});return null}
}

// Operational queue and conservative inventory, read-only. No "complete" switch
// that could claim success before the permanent processor has done its work.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  const prototype=process.env.ACCOUNT_DELETION_MODE==='prototype-emulator'
  if(req.method==='POST'){
    const ctx=await prototypeContext(req,res)
    if(!ctx)return
    const processor=createEmulatorDeletionProcessor({...ctx,provider:syntheticDeletionProvider(ctx.db)})
    return makeDeletionProcessingHandler({authorize:async()=>ctx.token,processor})(req,res)
  }
  if (prototype ? !await prototypeContext(req,res) : !await verifySuperAdmin(req, res)) return
  try {
    const db = getFirestore()
    const uid = req.query.uid
    if (uid !== undefined && (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) return res.status(400).json({ error: 'Invalid account identifier' })
    if (!uid) {
      const snap = await db.collection(DELETION_COLLECTION).where('status', 'in', ['requested', 'review_required', 'processing']).limit(100).get()
      return res.status(200).json({ requests: snap.docs.map(d => ({ uid: d.id, ...d.data() })), limit: 100, emulatorProcessingAvailable:prototype })
    }
    const request = await db.collection(DELETION_COLLECTION).doc(uid).get()
    if (!request.exists) return res.status(404).json({ error: 'Request not found' })
    const inventory = await buildDeletionInventory({ db, uid })
    return res.status(200).json({ request: request.data(), inventory, emulatorProcessingAvailable:prototype })
  } catch { return res.status(500).json({ error: 'Could not load deletion queue' }) }
}
