import { withAccountMutationFence } from './_lib/deletion-fence.js'
// api/transfer-dog.js — atomic ownership transfer + immutable privacy snapshot
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { hasDogWriteAccess } from './_lib/dog-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const SNAPSHOT_COLLECTION = 'ownershipHistorySnapshots'

function cleanString(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

  async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) return res.status(401).json({ error: 'Missing Authorization header' })

  let uid
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { dogId, buyerName, buyerEmail, buyerPhone, pedigreeRegister, breedingEligibility } = req.body || {}
  const safeBuyerName = cleanString(buyerName, 160)
  const safeBuyerEmail = cleanString(buyerEmail, 320).toLowerCase()
  const safeBuyerPhone = cleanString(buyerPhone, 80)

  if (!dogId || typeof dogId !== 'string' || !safeBuyerName || !safeBuyerEmail || !safeBuyerEmail.includes('@')) {
    return res.status(400).json({ error: 'dogId, buyerName and valid buyerEmail are required' })
  }

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)
  const snapshotRef = db.collection(SNAPSHOT_COLLECTION).doc()

  try {
    const result = await db.runTransaction(async tx => {
      const dogSnap = await tx.get(dogRef)
      if (!dogSnap.exists) throw Object.assign(new Error('DOG_NOT_FOUND'), { status: 404 })

      const dog = dogSnap.data()
      if (!hasDogWriteAccess(dog, uid)) throw Object.assign(new Error('NOT_OWNER'), { status: 403 })
      if (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') {
        throw Object.assign(new Error('TRANSFER_ALREADY_PENDING'), { status: 409 })
      }

      const queries = [
        db.collection('vaccineRecords').where('dogId', '==', dogId),
        db.collection('wormingRecords').where('dogId', '==', dogId),
        db.collection('healthTests').where('dogId', '==', dogId),
        db.collection('activityNotes').where('dogId', '==', dogId),
        db.collection('documents').where('dogId', '==', dogId),
        db.collection('reminders').where('dogId', '==', dogId),
        db.collection('heatCycles').where('dogId', '==', dogId),
        db.collection('scanLogs').where('dogId', '==', dogId),
      ]

      const [vaccinesSnap, wormingSnap, healthSnap, notesSnap, docsSnap, remindersSnap, heatSnap, scansSnap] =
        await Promise.all(queries.map(q => tx.get(q)))

      const mapDocs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const transferredAt = new Date().toISOString()

      tx.create(snapshotRef, {
        snapshotVersion: 1,
        dogId,
        fromOwnerId: uid,
        originalBreederId: dog.tenantId || null,
        toOwnerEmail: safeBuyerEmail,
        toOwnerName: safeBuyerName,
        transferredAt,
        createdAt: FieldValue.serverTimestamp(),
        dog: { ...dog, id: dogId },
        vaccineRecords: mapDocs(vaccinesSnap),
        wormingRecords: mapDocs(wormingSnap),
        healthTests: mapDocs(healthSnap),
        activityNotes: mapDocs(notesSnap),
        documents: mapDocs(docsSnap),
        reminders: mapDocs(remindersSnap),
        heatCycles: mapDocs(heatSnap),
        scanCount: scansSnap.size,
      })

      const updates = {
        status: 'transferred',
        transferStatus: 'pendingClaim',
        previousOwnerId: uid,
        buyerName: safeBuyerName,
        buyerEmail: safeBuyerEmail,
        transferredAt,
        historySnapshotId: snapshotRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (safeBuyerPhone) updates.buyerPhone = safeBuyerPhone
      if (pedigreeRegister !== undefined) updates.pedigreeRegister = pedigreeRegister
      if (breedingEligibility !== undefined) updates.breedingEligibility = breedingEligibility
      tx.update(dogRef, updates)

      return { transferredAt, snapshotId: snapshotRef.id }
    })

    return res.status(200).json({ success: true, ...result })
  } catch (err) {
    const code = err?.message || 'TRANSFER_FAILED'
    const status = err?.status || 500
    if (status >= 500) console.error('transfer-dog failed:', code)
    return res.status(status).json({ error: code })
  }
}

export default withAccountMutationFence(handler, { route: 'api/transfer-dog.js' })
