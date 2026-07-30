// api/update-showcase-media.js — trusted server-side reorder/delete
// (and, implicitly, "set cover") for an already-uploaded litter puppy's
// Showcase gallery (Slice 2). Cover/reorder/delete are all just array
// operations on `photos`/`videos` — index 0 is always the cover, so
// "make this one the cover" is just "reorder so it's first". There is
// no separate endpoint for cover/reorder/delete because there is no
// separate STATE for them to mutate — see src/types/index.ts's own
// comment on Dog.photos.
//
// SECURITY: the caller supplies the FULL desired array (`order`), but
// this endpoint only ever ACCEPTS it if every entry already exists in
// the dog's CURRENT array — it is a pure reorder/subset operation, never
// a way to inject an arbitrary URL. Adding a genuinely NEW item only
// ever happens through api/upload-showcase-media.js, which independently
// downloads, sniffs, validates, and re-uploads the actual file — this
// endpoint never accepts a raw URL string as new content.
//
// Any URL present in the OLD array but absent from the new `order` is
// being deleted — its underlying Storage object is removed too
// (best-effort; a cleanup failure never blocks the Firestore update
// itself, since the alternative — leaving the user's delete action
// half-applied — is worse than a rare orphaned Storage object).
//
// POST /api/update-showcase-media
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId, kind: 'photo' | 'video', order: string[] }
// Returns: { success: true, photos, videos } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { canAddDogRecord } from './_lib/dog-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// Extracts the Storage object path from a URL this project's own
// upload endpoints produce (https://storage.googleapis.com/{bucket}/{path}).
// Returns null for anything that doesn't match that exact shape —
// callers must treat null as "don't attempt deletion", never as an
// error that blocks the rest of the operation.
function storagePathFromPublicUrl(url, bucketName) {
  const prefix = `https://storage.googleapis.com/${bucketName}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null
  return url.slice(prefix.length)
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
  if (!Array.isArray(order) || !order.every(u => typeof u === 'string')) {
    return res.status(400).json({ error: 'order must be an array of strings' })
  }

  const db = getFirestore()

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data()

    if (!canAddDogRecord(dog, uid)) {
      return res.status(403).json({ error: 'Not authorized to update media for this dog' })
    }

    const arrayField = kind === 'photo' ? 'photos' : 'videos'
    const current = dog[arrayField] || []
    const currentSet = new Set(current)

    // Pure reorder/subset validation — see this file's own header
    // comment. Any URL in `order` that isn't already in `current` is
    // rejected outright (400), not silently dropped — a client sending
    // one means either a bug or an attempted injection, and either way
    // deserves a clear error rather than a surprising partial result.
    const orderSet = new Set(order)
    if (orderSet.size !== order.length) {
      return res.status(400).json({ error: 'order must not contain duplicate entries' })
    }
    for (const url of order) {
      if (!currentSet.has(url)) {
        return res.status(400).json({ error: 'order contains an item that is not part of this puppy\'s current media', reason: 'UNKNOWN_MEDIA_ITEM' })
      }
    }

    const removed = current.filter(url => !orderSet.has(url))

    await db.collection('dogs').doc(dogId).update({ [arrayField]: order, updatedAt: new Date() })

    // Best-effort Storage cleanup — never allowed to fail the request;
    // the Firestore update above (the part the user actually asked for)
    // has already succeeded by this point.
    if (removed.length > 0) {
      const bucket = getStorage().bucket(bucketName)
      await Promise.all(removed.map(async url => {
        const path = storagePathFromPublicUrl(url, bucket.name)
        if (!path) return
        try {
          await bucket.file(path).delete()
        } catch {
          // Orphaned Storage object — logged, never surfaced to the
          // caller, never retried synchronously here.
          logSanitizedError('update-showcase-media (cleanup)', 'STORAGE_CLEANUP_FAILED')
        }
      }))
    }

    const updatedSnap = await db.collection('dogs').doc(dogId).get()
    const updated = updatedSnap.data()
    return res.status(200).json({ success: true, photos: updated.photos || [], videos: updated.videos || [] })
  } catch (err) {
    logSanitizedError('update-showcase-media', 'UPDATE_FAILED')
    return res.status(500).json({ error: 'Update failed' })
  }
}

export default handler
