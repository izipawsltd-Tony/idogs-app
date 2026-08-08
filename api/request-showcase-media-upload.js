// api/request-showcase-media-upload.js — Implementation Phase 1: issues
// a short-lived, single-object signed Storage PUT URL for a puppy's
// Showcase gallery photo/video, so the browser can upload the file
// BYTES DIRECTLY to Storage instead of proxying them through this
// function as base64 JSON (the old api/upload-showcase-media.js path,
// left untouched/still working for compatibility — see that file's own
// header comment). This is what actually removes Vercel's ~4.5MB
// request-body ceiling from the equation for a real phone photo/video,
// rather than continuing to compress against it.
//
// This endpoint does NOT accept the file itself — it only decides
// WHETHER a fresh upload for this dog/kind/contentType may proceed, and
// if so, WHERE (a server-chosen, fresh-UUID path — never client-
// supplied) and for HOW LONG (10 minutes). The client must still call
// api/confirm-showcase-media-upload.js afterward — nothing is written to
// dog.photos/dog.videos here, and nothing this endpoint returns grants
// read access to anything.
//
// Authorization mirrors api/upload-showcase-media.js exactly:
// canAddDogRecord() (current effective owner, never on a restricted
// dog) — the SAME check every other dog-associated upload in this
// codebase uses. Re-checked AGAIN in confirm-showcase-media-upload.js,
// since dog ownership/status could change during the up-to-10-minute
// window between request and confirm.
//
// POST /api/request-showcase-media-upload
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId, kind: 'photo' | 'video', contentType }
// Returns: { mediaId, uploadUrl, requiredHeaders, expiresInSeconds } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { canAddDogRecord, hasDogWriteAccess } from './_lib/dog-access.js'
import { newMediaId, MAX_MEDIA_ITEMS_PER_KIND } from './_lib/showcase-media-access.js'
import { UPLOAD_URL_TTL_MS, MEDIA_UPLOAD_GRANTS_COLLECTION, extensionForUpload, NO_OVERWRITE_HEADER } from './_lib/direct-upload.js'

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
    logConfigError('request-showcase-media-upload', 'STORAGE_BUCKET_NOT_CONFIGURED')
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

  const { dogId, kind, contentType } = req.body || {}
  if (!dogId || typeof dogId !== 'string') return res.status(400).json({ error: 'dogId is required' })
  if (kind !== 'photo' && kind !== 'video') return res.status(400).json({ error: "kind must be 'photo' or 'video'" })
  if (!contentType || typeof contentType !== 'string') return res.status(400).json({ error: 'contentType is required' })

  // The ONLY thing that decides whether this upload may proceed and
  // what file extension its Storage path gets — never a client-supplied
  // filename/extension. An unrecognized {kind, contentType} pair (e.g. a
  // client trying to request an upload slot for an image/png or a
  // video/x-msvideo) is rejected before any Firestore/Storage call.
  const extension = extensionForUpload(kind, contentType)
  if (!extension) {
    return res.status(400).json({ error: `Unsupported contentType '${contentType}' for kind '${kind}'`, reason: 'UNSUPPORTED_CONTENT_TYPE' })
  }

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data()

    if (!canAddDogRecord(dog, uid)) {
      // Same distinguishable-reason behavior as upload-showcase-media.js
      // (Tony live-staging finding) — costs no security, points a
      // legitimately-owned-but-restricted puppy at the actual fix.
      const reason = hasDogWriteAccess(dog, uid) && dog?.status === 'restricted' ? 'DOG_RESTRICTED' : 'NOT_OWNER'
      return res.status(403).json({ error: 'Not authorized to upload media for this dog', reason })
    }

    // Early, best-effort cap check — saves a wasted upload for the
    // common case. Re-checked authoritatively in confirm (this dog's
    // gallery could change during the up-to-10-minute upload window).
    const existingCount = (kind === 'photo' ? dog.photos : dog.videos)?.length || 0
    if (existingCount >= MAX_MEDIA_ITEMS_PER_KIND) {
      return res.status(409).json({ error: `This puppy already has the maximum of ${MAX_MEDIA_ITEMS_PER_KIND} ${kind}s`, reason: 'MEDIA_LIMIT_REACHED' })
    }

    // Safe, unique, unguessable filename — a real random UUID, never
    // derived from any client-supplied name (never even accepted as
    // input here). Distinct from mediaId (matches the existing
    // upload-showcase-media.js convention of two independent UUIDs).
    const mediaId = newMediaId()
    const filePath = `dogs/${uid}/${dogId}/${kind}s/${randomUUID()}.${extension}`

    const expiresAtMs = Date.now() + UPLOAD_URL_TTL_MS
    await db.collection(MEDIA_UPLOAD_GRANTS_COLLECTION).doc(mediaId).set({
      uid,
      dogId,
      kind,
      path: filePath,
      contentType,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    })

    const file = bucket.file(filePath)
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAtMs,
      contentType,
      extensionHeaders: NO_OVERWRITE_HEADER,
    })

    return res.status(200).json({
      mediaId,
      uploadUrl,
      // The client's PUT request MUST send exactly these headers (in
      // addition to Content-Type: contentType) — they were signed as
      // part of the URL, so a mismatched or missing header fails GCS's
      // own signature verification, not just this app's own checks.
      requiredHeaders: { 'Content-Type': contentType, ...NO_OVERWRITE_HEADER },
      expiresInSeconds: Math.floor(UPLOAD_URL_TTL_MS / 1000),
    })
  } catch (err) {
    logSanitizedError('request-showcase-media-upload', 'REQUEST_UPLOAD_FAILED')
    return res.status(500).json({ error: 'Could not prepare upload' })
  }
}

export default handler
