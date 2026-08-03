// api/upload-showcase-media.js — trusted server-side photo/video upload
// for a litter puppy's Showcase gallery (Slice 2). Appends the result to
// the Dog document's `photos` or `videos` array — index 0 is the
// private-workspace "cover"; api/update-showcase-media.js handles
// reorder/delete on an already-uploaded array, and
// api/update-showcase-puppy.js handles which items (if any) are
// actually PUBLISHED to a given Showcase (uploading here never publishes
// anything by itself — see ShowcasePuppyEntry.publishedPhotoIds/
// publishedVideoIds).
//
// Reuses api/_lib/image-pipeline.js — the SAME reusable pipeline
// api/upload.js's avatar/profile path uses.
//
// Codex fix-round ("Revocable media delivery"): the uploaded file is
// PRIVATE — no file.makePublic() anywhere in this file. `dog.photos`/
// `dog.videos` store only { id, path } (see src/types/index.ts's
// MediaItem), never a public URL; this endpoint returns freshly-signed,
// short-lived URLs in its response for immediate display, but nothing
// durable/public is ever persisted.
//
// Codex fix-round ("Upload consistency"): if the Firestore update after
// a successful Storage write fails for any reason, the just-uploaded
// object is deleted before the error is returned — a failed database
// write must never leave an orphaned file behind.
//
// A puppy is just a Dog document (see create-litter-puppy.js) — the
// SAME authorization this codebase already uses for every other
// dog-associated upload (api/upload.js, api/upload-document.js) applies
// unchanged: canAddDogRecord() (current effective owner, never on a
// restricted dog).
//
// POST /api/upload-showcase-media
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId, base64, kind: 'photo' | 'video' }
// Returns: { success: true, mediaId, photos: [{id,url}], videos: [{id,url}] } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomUUID, createHash } from 'crypto'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { canAddDogRecord, hasDogWriteAccess } from './_lib/dog-access.js'
import { processImageForStorage, processVideoForStorage, ImagePipelineError } from './_lib/image-pipeline.js'
import { newMediaId, signMediaItems } from './_lib/showcase-media-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// Deliberately generous but bounded — Slice 2 requirement ("Multiple
// litter/puppy images") without letting a single puppy's document grow
// unbounded (Firestore documents have a real 1MB size ceiling, and a
// gallery this large would be a poor showcase experience regardless).
const MAX_MEDIA_ITEMS_PER_KIND = 30

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('upload-showcase-media', 'STORAGE_BUCKET_NOT_CONFIGURED')
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

  const { dogId, base64, kind } = req.body
  if (!dogId || typeof dogId !== 'string') return res.status(400).json({ error: 'dogId is required' })
  if (!base64 || typeof base64 !== 'string') return res.status(400).json({ error: 'base64 is required' })
  if (kind !== 'photo' && kind !== 'video') return res.status(400).json({ error: "kind must be 'photo' or 'video'" })

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data()

    if (!canAddDogRecord(dog, uid)) {
      // Tony live-staging finding: this generic message was returned for
      // two very different reasons — a genuine stranger/wrong-tenant
      // request, and a legitimately-owned puppy that happens to be
      // 'restricted' (very commonly a LEGACY litter puppy restricted
      // before the Pricing v1.2 cap exemption — see
      // api/_lib/dog-cap.js's header comment). Distinguishing the reason
      // costs no security (the write is still denied either way) and
      // lets the client point a breeder at the actual fix
      // (api/reconcile-litter-puppy.js) instead of a dead end.
      const reason = hasDogWriteAccess(dog, uid) && dog?.status === 'restricted' ? 'DOG_RESTRICTED' : 'NOT_OWNER'
      return res.status(403).json({ error: 'Not authorized to upload media for this dog', reason })
    }

    const existingCount = (kind === 'photo' ? dog.photos : dog.videos)?.length || 0
    if (existingCount >= MAX_MEDIA_ITEMS_PER_KIND) {
      return res.status(409).json({ error: `This puppy already has the maximum of ${MAX_MEDIA_ITEMS_PER_KIND} ${kind}s`, reason: 'MEDIA_LIMIT_REACHED' })
    }

    const rawBuffer = Buffer.from(base64, 'base64')

    let processed
    try {
      processed = kind === 'photo' ? await processImageForStorage(rawBuffer) : await processVideoForStorage(rawBuffer)
    } catch (err) {
      if (err instanceof ImagePipelineError) {
        return res.status(400).json({ error: err.message, reason: err.code })
      }
      throw err
    }

    // Duplicate-upload guard: hash the PROCESSED bytes (post-resize/
    // re-encode), so two uploads of visually-identical content land on
    // the same hash even if the original files differed in container/
    // metadata. Checked against this puppy's existing gallery for this
    // kind only — a photo and a video can never collide with each
    // other. Pre-existing items with no stored hash simply never match.
    const contentHash = createHash('sha256').update(processed.buffer).digest('hex')
    const existingItems = (kind === 'photo' ? dog.photos : dog.videos) || []
    if (existingItems.some(item => item?.hash === contentHash)) {
      return res.status(409).json({ error: `This ${kind} has already been uploaded for this puppy`, reason: 'DUPLICATE_MEDIA' })
    }

    // Safe, unique, unguessable filename — a real random UUID, never
    // derived from any client-supplied name (which is never even
    // accepted as input here in the first place). PRIVATE — deliberately
    // no file.makePublic() call anywhere in this file.
    const mediaId = newMediaId()
    const filePath = `dogs/${uid}/${dogId}/${kind}s/${randomUUID()}.${processed.extension}`
    const file = bucket.file(filePath)
    await file.save(processed.buffer, { metadata: { contentType: processed.mimeType } })

    const arrayField = kind === 'photo' ? 'photos' : 'videos'
    const mediaItem = { id: mediaId, path: filePath, hash: contentHash }
    try {
      await db.collection('dogs').doc(dogId).update({
        [arrayField]: FieldValue.arrayUnion(mediaItem),
        updatedAt: new Date(),
      })
    } catch (writeErr) {
      // Upload consistency fix: the Storage write already succeeded —
      // if the Firestore write that was supposed to reference it fails,
      // the object is now unreferenced by anything and must not be left
      // behind. Best-effort delete, then surface the ORIGINAL failure
      // (never mask a real error with a cleanup-related one).
      try {
        await file.delete()
      } catch {
        logSanitizedError('upload-showcase-media (orphan cleanup)', 'ORPHAN_CLEANUP_FAILED')
      }
      throw writeErr
    }

    const updatedSnap = await db.collection('dogs').doc(dogId).get()
    const updated = updatedSnap.data()
    const [photos, videos] = await Promise.all([
      signMediaItems(bucket, updated.photos || []),
      signMediaItems(bucket, updated.videos || []),
    ])
    return res.status(200).json({ success: true, mediaId, photos, videos })
  } catch (err) {
    logSanitizedError('upload-showcase-media', 'UPLOAD_FAILED')
    return res.status(500).json({ error: 'Upload failed' })
  }
}

export default handler
