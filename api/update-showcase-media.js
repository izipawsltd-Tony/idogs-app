import { reorderAccountMedia } from './_lib/account-media-writes.js'
import { ApiError } from './_lib/http-helpers.js'
// api/update-showcase-media.js — trusted server-side reorder/delete
// (and, implicitly, "set cover") for an already-uploaded litter puppy's
// Showcase gallery (Slice 2). Cover/reorder/delete are all just array
// operations on `photos`/`videos` — index 0 is always the
// private-workspace cover, so "make this one the cover" is just
// "reorder so it's first". There is no separate endpoint for cover/
// reorder/delete because there is no separate STATE for them to
// mutate — see src/types/index.ts's own comment on Dog.photos.
//
// SECURITY: the caller supplies the FULL desired array of media IDs
// (`order`), but this endpoint only ever ACCEPTS it if every id already
// exists in the dog's CURRENT array — it is a pure reorder/subset
// operation, never a way to inject new content. Adding a genuinely NEW
// item only ever happens through api/upload-showcase-media.js, which
// independently downloads, sniffs, validates, and re-uploads the actual
// file. `order` is a list of MediaItem.id values (opaque, unguessable —
// never a Storage path), not the items themselves.
//
// Removed gallery references queue durable cleanup review in the same commit.
// No request-time object deletion is safe without shared-reference evidence.
//
// Deleting an item here does NOT automatically un-publish it from any
// Showcase it may be part of — api/update-showcase-puppy.js's own
// publishedPhotoIds/publishedVideoIds validation independently drops
// any id that's no longer present in the dog's own gallery the next
// time it's read (see that endpoint), so a Showcase can never keep
// "publishing" an id that no longer resolves to anything.
//
// POST /api/update-showcase-media
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId, kind: 'photo' | 'video', order: string[] (media ids) }
// Returns: { success: true, photos: [{id,url}], videos: [{id,url}] } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { signMediaItems } from './_lib/showcase-media-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('update-showcase-media', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) return res.status(401).json({ error: 'Missing Authorization header' })

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { dogId, kind, order } = req.body
  if (!dogId || typeof dogId !== 'string') return res.status(400).json({ error: 'dogId is required' })
  if (kind !== 'photo' && kind !== 'video') return res.status(400).json({ error: "kind must be 'photo' or 'video'" })
  if (!Array.isArray(order) || !order.every(id => typeof id === 'string')) {
    return res.status(400).json({ error: 'order must be an array of media id strings' })
  }

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    const arrayField = kind === 'photo' ? 'photos' : 'videos'
    await reorderAccountMedia({ db, uid, dogId, arrayField, order, bucket: bucketName })

    const updatedSnap = await db.collection('dogs').doc(dogId).get()
    const updated = updatedSnap.data()
    const [photos, videos] = await Promise.all([
      signMediaItems(bucket, updated.photos || []),
      signMediaItems(bucket, updated.videos || []),
    ])
    return res.status(200).json({ success: true, photos, videos })
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, ...err.extra })
    logSanitizedError('update-showcase-media', 'UPDATE_FAILED')
    return res.status(500).json({ error: 'Update failed' })
  }
}

export default handler
