// api/confirm-landing-media-upload.js — Super Admin -> Landing Page
// Media. The second half of the direct-upload flow (see
// api/request-landing-media-upload.js for the first half). Called AFTER
// the admin's browser has already PUT the file bytes straight to Storage
// via the signed URL that endpoint issued.
//
// Mirrors api/confirm-showcase-media-upload.js's "never trust the
// client" posture exactly: every check runs against the REAL uploaded
// object, never the grant's client-claimed contentType/size — real
// magic-byte sniffing (via api/_lib/image-pipeline.js's own sniff
// functions, the same ones every other upload path in this codebase
// uses), narrowed to landing media's own explicit allowlist (JPG/PNG/
// WebP images, MP4/WebM video — no HEIC, no MOV, even though the shared
// sniffers recognize them; see api/_lib/landing-media.js's own header
// comment for why this list is deliberately narrower than Showcase's).
// Unlike Showcase, the original bytes are stored UNCHANGED (no resize/
// re-encode) — this is an admin-supplied marketing asset, not a phone
// photo, and preserving exact quality/format (including PNG
// transparency) is the point.
//
// The grant document written by request-landing-media-upload.js is the
// ONLY source of truth for {uid, slotId, kind, path} — the client sends
// only mediaId, never the path itself.
//
// A successful confirm REPLACES the slot's current draft (if any) — the
// previous draft's Storage object is deleted only AFTER the new draft is
// safely recorded in Firestore, never before, so a failed confirm can
// never destroy a still-valid previous draft.
//
// POST /api/confirm-landing-media-upload
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { mediaId, filename? }
// Returns: { success: true, slotId, draft: {...} } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { requireSuperAdmin } from './_lib/admin-access.js'
import { sniffImageMimeType, sniffVideoMimeType } from './_lib/image-pipeline.js'
import {
  LANDING_MEDIA_GRANTS_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION,
  LANDING_DRAFT_PREVIEW_URL_TTL_MS, maxBytesForLandingKind, sanitizeDisplayFilename,
} from './_lib/landing-media.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// Landing media's own allowlist is a STRICT SUBSET of what the shared
// sniffers recognize — image/heic and video/quicktime are real,
// correctly-sniffed values that must still be rejected here, because
// they are not on landing media's accepted-type list (see
// api/_lib/landing-media.js's header comment).
const ALLOWED_IMAGE_SNIFFS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_VIDEO_SNIFFS = new Set(['video/mp4', 'video/webm'])

async function deleteObjectQuietly(bucket, path) {
  if (!path) return
  try {
    await bucket.file(path).delete()
  } catch {
    logSanitizedError('confirm-landing-media-upload (cleanup)', 'CLEANUP_FAILED')
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('confirm-landing-media-upload', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const admin = await requireSuperAdmin(req, getAuth)
  if (!admin) return res.status(403).json({ error: 'Not authorized' })

  const { mediaId, filename } = req.body || {}
  if (!mediaId || typeof mediaId !== 'string') return res.status(400).json({ error: 'mediaId is required' })

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)
  const grantRef = db.collection(LANDING_MEDIA_GRANTS_COLLECTION).doc(mediaId)

  try {
    const grantSnap = await grantRef.get()
    if (!grantSnap.exists) return res.status(404).json({ error: 'Upload grant not found', reason: 'GRANT_NOT_FOUND' })
    const grant = grantSnap.data()

    // A grant belongs to exactly the admin uid it was issued to.
    if (grant.uid !== admin.uid) {
      return res.status(403).json({ error: 'Not authorized to confirm this upload', reason: 'NOT_GRANT_OWNER' })
    }
    if (grant.status !== 'pending') {
      return res.status(409).json({ error: 'This upload has already been confirmed', reason: 'ALREADY_CONFIRMED' })
    }
    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'expired', expiredAt: new Date().toISOString() })
      return res.status(410).json({ error: 'This upload window has expired — please try uploading again', reason: 'GRANT_EXPIRED' })
    }

    const file = bucket.file(grant.path)
    const [exists] = await file.exists()
    if (!exists) {
      await grantRef.update({ status: 'rejected', rejectedAt: new Date().toISOString() })
      return res.status(400).json({ error: 'No file was found at the expected upload location — please try uploading again', reason: 'OBJECT_NOT_UPLOADED' })
    }

    // Independent, server-side size check against the REAL Storage
    // object — never the client-claimed expectedSizeBytes. Checked via
    // metadata BEFORE downloading the full object.
    const [metadata] = await file.getMetadata()
    const actualSize = Number(metadata.size)
    const maxBytes = maxBytesForLandingKind(grant.kind)
    if (!Number.isFinite(actualSize) || actualSize > maxBytes) {
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'rejected', rejectedAt: new Date().toISOString() })
      return res.status(400).json({
        error: `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`,
        reason: 'FILE_TOO_LARGE',
      })
    }

    // Real, server-side validation of the ACTUAL uploaded bytes — never
    // trusts the contentType the client claimed at request time.
    const [rawBuffer] = await file.download()
    const sniffed = grant.kind === 'image' ? sniffImageMimeType(rawBuffer) : sniffVideoMimeType(rawBuffer)
    const allowedSet = grant.kind === 'image' ? ALLOWED_IMAGE_SNIFFS : ALLOWED_VIDEO_SNIFFS
    if (!sniffed || !allowedSet.has(sniffed)) {
      await deleteObjectQuietly(bucket, grant.path)
      await grantRef.update({ status: 'rejected', rejectedAt: new Date().toISOString() })
      return res.status(400).json({
        error: grant.kind === 'image'
          ? 'File is not a recognized image type (JPG, PNG, or WebP)'
          : 'File is not a recognized video type (MP4 or WebM)',
        reason: grant.kind === 'image' ? 'UNSUPPORTED_IMAGE_TYPE' : 'UNSUPPORTED_VIDEO_TYPE',
      })
    }

    const draftRef = db.collection(LANDING_MEDIA_DRAFTS_COLLECTION).doc(grant.slotId)
    const previousDraftSnap = await draftRef.get()
    const previousDraftPath = previousDraftSnap.exists ? previousDraftSnap.data()?.path : null

    const draft = {
      slotId: grant.slotId,
      kind: grant.kind,
      path: grant.path,
      contentType: sniffed,
      filename: sanitizeDisplayFilename(filename || ''),
      sizeBytes: actualSize,
      mediaId,
      uploadedAt: new Date().toISOString(),
      uploadedBy: admin.uid,
    }

    await db.runTransaction(async tx => {
      const freshGrantSnap = await tx.get(grantRef)
      if (!freshGrantSnap.exists || freshGrantSnap.data()?.status !== 'pending') {
        throw Object.assign(new Error('ALREADY_CONFIRMED'), { code: 'ALREADY_CONFIRMED' })
      }
      tx.set(draftRef, draft)
      tx.update(grantRef, { status: 'confirmed', confirmedAt: new Date().toISOString() })
    })

    // Only after the new draft is safely committed: clean up the
    // PREVIOUS draft's Storage object, if it was a different path (never
    // the object we just confirmed, and never anything published).
    if (previousDraftPath && previousDraftPath !== grant.path) {
      await deleteObjectQuietly(bucket, previousDraftPath)
    }

    const [previewUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + LANDING_DRAFT_PREVIEW_URL_TTL_MS })

    return res.status(200).json({ success: true, slotId: grant.slotId, draft: { ...draft, previewUrl } })
  } catch (err) {
    if (err?.code === 'ALREADY_CONFIRMED') {
      return res.status(409).json({ error: 'This upload has already been confirmed', reason: 'ALREADY_CONFIRMED' })
    }
    logSanitizedError('confirm-landing-media-upload', 'CONFIRM_UPLOAD_FAILED')
    return res.status(500).json({ error: 'Could not confirm upload' })
  }
}

export default handler
