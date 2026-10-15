// api/get-dog-history.js — immutable former-owner history snapshots
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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

function jsonValue(value) {
  if (value == null) return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(jsonValue)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = jsonValue(v)
    return out
  }
  return value
}

function publicSnapshot(doc) {
  const data = doc.data()
  return jsonValue({
    id: doc.id,
    snapshotVersion: data.snapshotVersion || 1,
    dogId: data.dogId,
    fromOwnerId: data.fromOwnerId,
    transferredAt: data.transferredAt,
    toOwnerName: data.toOwnerName,
    toOwnerEmail: data.toOwnerEmail,
    dog: data.dog || {},
    vaccineRecords: data.vaccineRecords || [],
    wormingRecords: data.wormingRecords || [],
    healthTests: data.healthTests || [],
    activityNotes: data.activityNotes || [],
    documents: data.documents || [],
    reminders: data.reminders || [],
    heatCycles: data.heatCycles || [],
    scanCount: Number(data.scanCount || 0),
  })
}

export default async function handler(req, res) {
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

  const { action = 'list', dogId } = req.body || {}
  const db = getFirestore()

  try {
    if (action === 'detail') {
      if (!dogId || typeof dogId !== 'string') return res.status(400).json({ error: 'dogId required' })
      const snap = await db.collection(SNAPSHOT_COLLECTION)
        .where('dogId', '==', dogId)
        .where('fromOwnerId', '==', uid)
        .get()
      if (snap.empty) return res.status(404).json({ error: 'History not found' })

      const docs = snap.docs.slice().sort((a, b) =>
        String(b.data().transferredAt || '').localeCompare(String(a.data().transferredAt || ''))
      )
      return res.status(200).json({ snapshot: publicSnapshot(docs[0]) })
    }

    const snap = await db.collection(SNAPSHOT_COLLECTION).where('fromOwnerId', '==', uid).get()
    const latestByDog = new Map()
    for (const doc of snap.docs) {
      const current = latestByDog.get(doc.data().dogId)
      if (!current || String(doc.data().transferredAt || '') > String(current.data().transferredAt || '')) {
        latestByDog.set(doc.data().dogId, doc)
      }
    }
    const dogs = Array.from(latestByDog.values()).map(doc => {
      const s = publicSnapshot(doc)
      return {
        ...s.dog,
        id: s.dogId,
        status: 'transferred',
        currentOwnerId: '__historical__',
        historicalSnapshot: true,
        historySnapshotId: s.id,
        transferredAt: s.transferredAt,
        buyerName: s.toOwnerName,
        buyerEmail: s.toOwnerEmail,
      }
    })
    return res.status(200).json({ dogs })
  } catch (err) {
    console.error('get-dog-history failed')
    return res.status(500).json({ error: 'History load failed' })
  }
}
