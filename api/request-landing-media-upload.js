// api/request-landing-media-upload.js — Super Admin -> Landing Page
// Media. Issues a short-lived, single-object signed Storage PUT URL for
// one of the four fixed landing-page slots, so the admin's browser can
// upload the file BYTES DIRECTLY to Storage. Mirrors
// api/request-showcase-media-upload.js's architecture exactly (see that
// file's own header comment for the full "why direct upload" rationale)
// — the difference here is authorization (Super Admin allowlist, not dog
// ownership) and the accepted file-type/size allowlist (see
// api/_lib/landing-media.js).
//
// This endpoint does NOT accept the file itself — it only decides
// WHETHER a fresh draft upload for this slot/kind/contentType may
// proceed, and if so WHERE (a server-chosen, fresh-UUID path under
// landing-media/{slotId}/drafts/ — never client-supplied) and for HOW
// LONG. The client must still call api/confirm-landing-media-upload.js
// afterward — nothing is written to landingMediaDrafts here, and this
// response grants no read access to anything (the object stays PRIVATE
// until confirmed and, later, explicitly Published).
//
// POST /api/request-landing-media-upload
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { slotId, kind: 'image' | 'video', contentType, sizeBytes }
// Returns: { mediaId, uploadUrl, requiredHeaders, expiresInSeconds } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { randomUUID, createHash } from 'crypto'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { requireSuperAdmin } from './_lib/admin-access.js'
import {
  isValidSlotId, extensionForLandingUpload, maxBytesForLandingKind,
  LANDING_UPLOAD_URL_TTL_MS, LANDING_MEDIA_GRANTS_COLLECTION, NO_OVERWRITE_HEADER,
} from './_lib/landing-media.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'

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
    logConfigError('request-landing-media-upload', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const admin = await requireSuperAdmin(req, getAuth)
  if (!admin) return res.status(403).json({ error: 'Not authorized' })

  const { slotId, kind, contentType, sizeBytes } = req.body || {}
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'Invalid slotId' })
  if (kind !== 'image' && kind !== 'video') return res.status(400).json({ error: "kind must be 'image' or 'video'" })
  if (!contentType || typeof contentType !== 'string') return res.status(400).json({ error: 'contentType is required' })
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return res.status(400).json({ error: 'sizeBytes is required and must be a positive number' })
  }

  // The ONLY thing that decides whether this upload may proceed and what
  // file extension its Storage path gets — never a client-supplied
  // filename/extension.
  const extension = extensionForLandingUpload(kind, contentType)
  if (!extension) {
    return res.status(400).json({ error: `Unsupported contentType '${contentType}' for kind '${kind}'`, reason: 'UNSUPPORTED_CONTENT_TYPE' })
  }

  const maxBytes = maxBytesForLandingKind(kind)
  if (sizeBytes > maxBytes) {
    return res.status(400).json({
      error: `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit for ${kind === 'video' ? 'video' : 'image'} uploads`,
      reason: 'FILE_TOO_LARGE',
    })
  }

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  // Rate-limited per admin uid — a tiny, trusted allowlist (at most two
  // people), but this costs nothing and keeps the same defensive posture
  // as every other upload-request endpoint in this codebase.
  const rateKey = createHash('sha256').update(admin.uid).digest('hex')
  const rate = await checkDurableRateLimit(db, 'landing-media-upload', rateKey, 10 * 60 * 1000, 60)
  if (!rate.allowed) {
    res.setHeader?.('Retry-After', String(rate.retryAfterSeconds))
    return res.status(429).json({ error: 'Too many upload requests — please wait and try again', reason: 'UPLOAD_RATE_LIMITED' })
  }

  try {
    // Safe, unique, unguessable filename — a real random UUID, never
    // derived from any client-supplied name. The slotId is part of the
    // path (a fixed, server-validated value from SLOT_IDS — never a raw
    // client string), so a draft for one slot can never collide with, or
    // be confused for, another slot's draft.
    const mediaId = randomUUID()
    const filePath = `landing-media/${slotId}/drafts/${randomUUID()}.${extension}`

    const expiresAtMs = Date.now() + LANDING_UPLOAD_URL_TTL_MS
    const grant = {
      uid: admin.uid,
      slotId,
      kind,
      path: filePath,
      contentType,
      expectedSizeBytes: sizeBytes,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
    await db.collection(LANDING_MEDIA_GRANTS_COLLECTION).doc(mediaId).create(grant)

    const file = bucket.file(filePath)
    let uploadUrl
    try {
      ;[uploadUrl] = await file.getSignedUrl({
        version: 'v4', action: 'write', expires: expiresAtMs, contentType,
        extensionHeaders: NO_OVERWRITE_HEADER,
      })
    } catch (signError) {
      await db.collection(LANDING_MEDIA_GRANTS_COLLECTION).doc(mediaId).update({ status: 'rejected', rejectedAt: new Date().toISOString() })
      throw signError
    }

    return res.status(200).json({
      mediaId,
      uploadUrl,
      requiredHeaders: { 'Content-Type': contentType, ...NO_OVERWRITE_HEADER },
      expiresInSeconds: Math.floor(LANDING_UPLOAD_URL_TTL_MS / 1000),
    })
  } catch (err) {
    logSanitizedError('request-landing-media-upload', 'REQUEST_UPLOAD_FAILED')
    return res.status(500).json({ error: 'Could not prepare upload' })
  }
}

export default handler
