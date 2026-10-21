import { queueGrantCleanup } from './_lib/media-cleanup.js'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { checkCronAuth } from './_lib/cron-auth.js'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { MEDIA_UPLOAD_GRANTS_COLLECTION } from './_lib/direct-upload.js'
import { closePendingGrant } from './_lib/direct-upload-grants.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = checkCronAuth(req)
  if (!auth.authorized) return res.status(auth.status).json(auth.body)
  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('cleanup-showcase-media-uploads', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const db = getFirestore()
  let queued = 0
  let failed = 0
  try {
    // Single-field query: no composite index required. Terminal grants
    // cannot crowd abandoned uploads out of the batch.
    const expired = await db.collection(MEDIA_UPLOAD_GRANTS_COLLECTION)
      .where('status', 'in', ['pending', 'expired', 'rejected', 'duplicate']).limit(200).get()
    for (const doc of expired.docs) {
      const grant = doc.data()
      if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) > Date.now()) continue
      try {
        if (grant.status === 'pending') {
          const claimed = await closePendingGrant(db, doc.ref, 'expired', { expiredAt: new Date().toISOString() })
          if (!claimed) continue
        }
        await queueGrantCleanup({ db, grantRef: doc.ref, bucket: bucketName })
        queued += 1
      } catch {
        failed += 1
        logSanitizedError('cleanup-showcase-media-uploads', 'GRANT_CLEANUP_FAILED')
      }
    }
    return res.status(failed ? 207 : 200).json({ success: failed === 0, scanned: expired.size, cleaned: 0, queued, failed })
  } catch {
    logSanitizedError('cleanup-showcase-media-uploads', 'CLEANUP_FAILED')
    return res.status(500).json({ error: 'Could not clean expired uploads' })
  }
}
