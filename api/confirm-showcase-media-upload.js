// api/confirm-showcase-media-upload.js — Implementation Phase 1: the
// second half of the direct-upload flow (see
// api/request-showcase-media-upload.js for the first half and the
// overall security model). Called AFTER the browser has already PUT the
// file bytes straight to Storage via the signed URL that endpoint
// issued.
//
// This is where "never trust the client" is actually enforced for a
// direct upload: the server did not see the bytes at request time, so
// every check api/upload-showcase-media.js used to run BEFORE accepting
// a base64 body now runs AFTER the fact, against the real uploaded
// object — real magic-byte sniffing (never a client-supplied
// contentType claim), a real size check, and a real existence check —
// reusing the EXACT SAME processImageForStorage()/processVideoForStorage()
// pipeline functions the old proxy path uses, just fed by
// `bucket.file(path).download()` instead of a request-body buffer. If
// any of this fails, the just-uploaded object is deleted — an unproven
// file must never be left referencing nothing, mirroring
// upload-showcase-media.js's own orphan-cleanup behavior.
//
// The grant document written by request-showcase-media-upload.js is the
// ONLY source of truth for {uid, dogId, kind, path} — the client sends
// only mediaId, never the path itself (so a client can never point this
// endpoint at an arbitrary Storage object it didn't upload through this
// exact flow).
//
// POST /api/confirm-showcase-media-upload
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { mediaId }
// Returns: { success: true, mediaId, photos: [{id,url}], videos: [{id,url}] } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { canAddDogRecord, hasDogWriteAccess } from './_lib/dog-access.js'
import { processImageForStorage, processVideoForStorage, ImagePipelineError } from './_lib/image-pipeline.js'
import { signMediaItems, MAX_MEDIA_ITEMS_PER_KIND } from './_lib/showcase-media-access.js'
import { MEDIA_UPLOAD_GRANTS_COLLECTION, MAX_DIRECT_VIDEO_UPLOAD_BYTES } from './_lib/direct-upload.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// Best-effort delete of an unconfirmed/invalid upload — never lets a
// cleanup failure mask the real error being returned to the client.
async function deleteObjectQuietly(bucket, path) {
  try {
    await bucket.file(path).delete()
  } catch {
    logSanitizedError('confirm-showcase-media-upload (cleanup)', 'CLEANUP_FAILED')
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('confirm-showcase-media-upload', 'STORAGE_BUCKET_NOT_CONFIGURED')
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

  const { mediaId } = req.body || {}
  if (!mediaId || typeof mediaId !== 'string') return res.status(400).json({ error: 'mediaId is required' })

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)
  const grantRef = db.collection(MEDIA_UPLOAD_GRANTS_COLLECTION).doc(mediaId)

  try {
    const grantSnap = await grantRef.get()
    if (!grantSnap.exists) return res.status(404).json({ error: 'Upload grant not found', reason: 'GRANT_NOT_FOUND' })
    const grant = grantSnap.data()

    // A grant belongs to exactly the uid it was issued to — never
    // resolvable by anyone else, regardless of whether they happen to
    // know/guess a mediaId.
    if (grant.uid !== uid) {
      return res.status(403).json({ error: 'Not authorized to confirm this upload', reason: 'NOT_GRANT_OWNER' })
    }

    if (grant.status !== 'pending') {
      return res.status(409).json({ error: 'This upload has already been confirmed', reason: 'ALREADY_CONFIRMED' })
    }

    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      // The grant window has closed — treat whatever (if anything) was
      // uploaded to that path as abandoned. Best-effort delete now
      // rather than leaving it for a future cleanup pass to discover,
      // and mark the grant expired so it's not mistaken for still-open.
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'expired' })
      return res.status(410).json({ error: 'This upload window has expired — please try uploading again', reason: 'GRANT_EXPIRED' })
    }

    // Re-verify ownership NOW, not just at request time — the up-to-
    // 10-minute upload window is long enough for a transfer/restriction
    // to have happened in between.
    const dogSnap = await db.collection('dogs').doc(grant.dogId).get()
    if (!dogSnap.exists) {
      await deleteObjectQuietly(bucket, grant.path)
      return res.status(404).json({ error: 'Dog not found' })
    }
    const dog = dogSnap.data()
    if (!canAddDogRecord(dog, uid)) {
      const reason = hasDogWriteAccess(dog, uid) && dog?.status === 'restricted' ? 'DOG_RESTRICTED' : 'NOT_OWNER'
      return res.status(403).json({ error: 'Not authorized to upload media for this dog', reason })
    }

    const kind = grant.kind
    const existingItems = (kind === 'photo' ? dog.photos : dog.videos) || []
    if (existingItems.length >= MAX_MEDIA_ITEMS_PER_KIND) {
      await deleteObjectQuietly(bucket, grant.path)
      return res.status(409).json({ error: `This puppy already has the maximum of ${MAX_MEDIA_ITEMS_PER_KIND} ${kind}s`, reason: 'MEDIA_LIMIT_REACHED' })
    }

    const file = bucket.file(grant.path)
    const [exists] = await file.exists()
    if (!exists) {
      return res.status(400).json({ error: 'No file was found at the expected upload location — please try uploading again', reason: 'OBJECT_NOT_UPLOADED' })
    }

    // Independent, server-side size check against the REAL Storage
    // object — never the client-claimed expectedSizeBytes on the grant
    // (a client could lie about that at request time). Checked via
    // Storage metadata BEFORE downloading the full object, both so an
    // oversized video is rejected without this function ever pulling a
    // large buffer into memory, and so this is the actual security
    // boundary the request-time check (a fast-fail UX convenience only)
    // cannot itself provide.
    if (kind === 'video') {
      const [metadata] = await file.getMetadata()
      const actualSize = Number(metadata.size)
      if (!Number.isFinite(actualSize) || actualSize > MAX_DIRECT_VIDEO_UPLOAD_BYTES) {
        await deleteObjectQuietly(bucket, grant.path)
        await grantRef.update({ status: 'rejected' })
        return res.status(400).json({
          error: `Video exceeds the ${Math.floor(MAX_DIRECT_VIDEO_UPLOAD_BYTES / (1024 * 1024))}MB direct-upload limit`,
          reason: 'FILE_TOO_LARGE',
        })
      }
    }

    // Real, server-side validation of the ACTUAL uploaded bytes — never
    // trusts the contentType the client claimed when requesting the
    // grant. Reuses the exact same pipeline functions the base64-proxy
    // path uses, so a direct upload is held to identical rules (magic-
    // byte sniffing, a broader sanity size ceiling, HEIC/HEIF handling
    // for photos, MP4/MOV/WebM sniffing for video).
    const [rawBuffer] = await file.download()
    let processed
    try {
      processed = kind === 'photo' ? await processImageForStorage(rawBuffer) : await processVideoForStorage(rawBuffer)
    } catch (err) {
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'rejected' })
      if (err instanceof ImagePipelineError) {
        return res.status(400).json({ error: err.message, reason: err.code })
      }
      throw err
    }

    // Direct-upload photos are always the already-compressed JPEG
    // lib/imageCompression.ts produces client-side — processImageForStorage
    // passes a real JPEG through unchanged (see that module's own header
    // comment), so `processed.buffer` here is identical to what was
    // downloaded. Hashing it (rather than the raw pre-sniff buffer) keeps
    // this identical in spirit to upload-showcase-media.js's own
    // "hash the PROCESSED bytes" dedup guard.
    const contentHash = createHash('sha256').update(processed.buffer).digest('hex')
    if (existingItems.some(item => item?.hash === contentHash)) {
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'duplicate' })
      return res.status(409).json({ error: `This ${kind} has already been uploaded for this puppy`, reason: 'DUPLICATE_MEDIA' })
    }

    const arrayField = kind === 'photo' ? 'photos' : 'videos'
    const mediaItem = { id: mediaId, path: grant.path, hash: contentHash }
    try {
      await db.collection('dogs').doc(grant.dogId).update({
        [arrayField]: FieldValue.arrayUnion(mediaItem),
        updatedAt: new Date(),
      })
    } catch (writeErr) {
      await deleteObjectQuietly(bucket, grant.path)
      throw writeErr
    }

    await grantRef.update({ status: 'confirmed', confirmedAt: new Date().toISOString() })

    const updatedSnap = await db.collection('dogs').doc(grant.dogId).get()
    const updated = updatedSnap.data()
    const [photos, videos] = await Promise.all([
      signMediaItems(bucket, updated.photos || []),
      signMediaItems(bucket, updated.videos || []),
    ])
    return res.status(200).json({ success: true, mediaId, photos, videos })
  } catch (err) {
    logSanitizedError('confirm-showcase-media-upload', 'CONFIRM_UPLOAD_FAILED')
    return res.status(500).json({ error: 'Could not confirm upload' })
  }
}

export default handler
