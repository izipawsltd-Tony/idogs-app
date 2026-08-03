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
// Any id present in the OLD array but absent from the new `order` is
// being deleted — its underlying Storage object is removed too
// (best-effort; a cleanup failure never blocks the Firestore update
// itself, since the alternative — leaving the user's delete action
// half-applied — is worse than a rare orphaned Storage object).
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
import { canAddDogRecord, hasDogWriteAccess } from './_lib/dog-access.js'
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
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data()

    if (!canAddDogRecord(dog, uid)) {
      // See api/upload-showcase-media.js's identical check for why this
      // distinguishes a restricted-but-owned dog (very often a legacy
      // litter puppy needing api/reconcile-litter-puppy.js) from a
      // genuine stranger/wrong-tenant denial.
      const reason = hasDogWriteAccess(dog, uid) && dog?.status === 'restricted' ? 'DOG_RESTRICTED' : 'NOT_OWNER'
      return res.status(403).json({ error: 'Not authorized to update media for this dog', reason })
    }

    const arrayField = kind === 'photo' ? 'photos' : 'videos'
    const current = dog[arrayField] || []
    const currentById = new Map(current.map(item => [item.id, item]))

    // Pure reorder/subset validation — see this file's own header
    // comment. Any id in `order` that isn't already in `current` is
    // rejected outright (400), not silently dropped.
    const orderSet = new Set(order)
    if (orderSet.size !== order.length) {
      return res.status(400).json({ error: 'order must not contain duplicate entries' })
    }
    for (const id of order) {
      if (!currentById.has(id)) {
        return res.status(400).json({ error: 'order contains an item that is not part of this puppy\'s current media', reason: 'UNKNOWN_MEDIA_ITEM' })
      }
    }

    const newItems = order.map(id => currentById.get(id))
    const removedItems = current.filter(item => !orderSet.has(item.id))

    await db.collection('dogs').doc(dogId).update({ [arrayField]: newItems, updatedAt: new Date() })

    // Best-effort Storage cleanup — never allowed to fail the request;
    // the Firestore update above (the part the user actually asked for)
    // has already succeeded by this point.
    if (removedItems.length > 0) {
      await Promise.all(removedItems.map(async item => {
        try {
          await bucket.file(item.path).delete()
        } catch {
          // Orphaned Storage object — logged, never surfaced to the
          // caller, never retried synchronously here.
          logSanitizedError('update-showcase-media (cleanup)', 'STORAGE_CLEANUP_FAILED')
        }
      }))
    }

    const updatedSnap = await db.collection('dogs').doc(dogId).get()
    const updated = updatedSnap.data()
    const [photos, videos] = await Promise.all([
      signMediaItems(bucket, updated.photos || []),
      signMediaItems(bucket, updated.videos || []),
    ])
    return res.status(200).json({ success: true, photos, videos })
  } catch (err) {
    logSanitizedError('update-showcase-media', 'UPDATE_FAILED')
    return res.status(500).json({ error: 'Update failed' })
  }
}

export default handler
