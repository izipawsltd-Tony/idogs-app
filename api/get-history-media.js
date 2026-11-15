import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { requireStorageBucket } from './_lib/require-config.js'
import { allowedHistoricalMedia } from './_lib/legacy-history-recovery.js'
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return res.status(401).json({ error: 'Sign in required' })
  let uid
  try { uid = (await getAuth().verifyIdToken(token)).uid } catch { return res.status(401).json({ error: 'Sign in required' }) }
  const { snapshotId, dogId } = req.body || {}
  if (typeof snapshotId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(snapshotId) || typeof dogId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(dogId)) return res.status(400).json({ error: 'Invalid history' })
  const bucketName = requireStorageBucket()
  if (!bucketName) return res.status(500).json({ error: 'Storage unavailable' })
  try {
    const doc = await getFirestore().collection('ownershipHistorySnapshots').doc(snapshotId).get()
    if (!doc.exists || doc.data().fromOwnerId !== uid || doc.data().dogId !== dogId) return res.status(404).json({ error: 'History not found' })
    const bucket = getStorage().bucket(bucketName)
    const photos = await Promise.all((doc.data().recoveredMedia || []).map(async (media, index) => {
      if (!allowedHistoricalMedia(media, uid, dogId)) return null
      try {
        // Never serve the current generation of a subsequently overwritten file.
        const file = bucket.file(media.path, { generation: media.generation })
        const [metadata] = await file.getMetadata()
        if (String(metadata.generation) !== media.generation) return null
        const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000, queryParams: { generation: media.generation } })
        return { id: String(index), url }
      } catch { return null }
    }))
    return res.status(200).json({ photos: photos.filter(Boolean), unavailable: photos.filter(p => !p).length })
  } catch { return res.status(500).json({ error: 'Historical photos unavailable' }) }
}
