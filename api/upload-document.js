// api/upload-document.js — Vercel serverless
// Receives file as base64, uploads to Firebase Storage via Admin SDK

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { canAddDogRecord } from './_lib/dog-access.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MEDIA_TYPES = new Map([
  ['application/pdf', { extension: 'pdf', fileType: 'pdf' }],
  ['image/jpeg', { extension: 'jpg', fileType: 'jpg' }],
  ['image/png', { extension: 'png', fileType: 'png' }],
  ['image/webp', { extension: 'webp', fileType: 'webp' }],
  ['image/heic', { extension: 'heic', fileType: 'heic' }],
  ['image/heif', { extension: 'heic', fileType: 'heic' }],
])

// Init Firebase Admin (once)
//
// Bounded staging-isolation safety patch: storageBucket is intentionally
// NOT passed here anymore — it used to fall back to
// `${FIREBASE_PROJECT_ID}.firebasestorage.app`, and ultimately to the
// hardcoded PRODUCTION bucket name if even FIREBASE_PROJECT_ID was
// missing. The bucket is now resolved explicitly, per request, via
// requireStorageBucket() below and passed directly to
// getStorage().bucket(name) at the point of use — never defaulted here.
if (!getApps().length) {
  // Firebase private key: replace escaped newlines and convert RSA → PKCS8 if needed
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
  privateKey = privateKey.replace(/\\n/g, '\n')

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Fail closed BEFORE any Firebase/Storage request, and before even
  // verifying the caller's token — a missing/malformed
  // FIREBASE_STORAGE_BUCKET must never be papered over by silently
  // targeting production, regardless of who's asking.
  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('upload-document', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  // SECURITY FIX: this endpoint previously trusted dogId/tenantId straight
  // from the request body with no auth check at all. Since it uses the
  // Admin SDK (bypasses Firestore/Storage rules), anyone who knew or
  // guessed a dogId could POST here directly (no UI needed — just replay
  // a captured request) and write documents into another breeder's dog
  // record. Now requires a valid Firebase ID token, and verifies the
  // caller actually owns/breeds the target dog before writing anything.
  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { base64, mediaType, dogId, documentType, extractedData, title, notes, source } = req.body

  if (typeof base64 !== 'string' || !base64 || typeof dogId !== 'string' || !dogId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  const media = ALLOWED_MEDIA_TYPES.get(mediaType)
  if (!media) {
    return res.status(415).json({ error: 'Unsupported file type' })
  }
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    return res.status(413).json({ error: 'File must be 10MB or smaller' })
  }
  if ((title != null && typeof title !== 'string') || (notes != null && typeof notes !== 'string')) {
    return res.status(400).json({ error: 'Invalid document metadata' })
  }

  const db = getFirestore()

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) {
      return res.status(404).json({ error: 'Dog not found' })
    }
    const dog = dogSnap.data()
    // Codex H8 (round 2) — a document upload CREATES a new documents/{id}
    // record, so this must match firestore.rules' dogAllowsNewRecords
    // (current effective owner only, and never on a restricted dog) —
    // not the broader read-level tenantId-OR-currentOwnerId check this
    // used to have, which let a former breeder (tenantId still matches,
    // no longer currentOwnerId) upload onto a dog they no longer own.
    if (!canAddDogRecord(dog, uid)) {
      return res.status(403).json({ error: 'Not authorized to upload documents for this dog' })
    }

    const safeDocumentType = typeof documentType === 'string' && documentType ? documentType : 'other'
    const fileName = `${safeDocumentType}_${Date.now()}.${media.extension}`
    // Use the verified uid (not a client-supplied tenantId) for the path —
    // this can legitimately be the dog's breeder OR its current owner,
    // whichever account is doing the scanning.
    const filePath = `documents/${uid}/${dogId}/${fileName}`

    // Upload to Firebase Storage
    const bucket = getStorage().bucket(bucketName)
    const file = bucket.file(filePath)
    await file.save(buffer, {
      metadata: { contentType: mediaType },
    })

    // SECURITY FIX (separate from the auth fix above): files used to be
    // made public via file.makePublic(), which generates a permanent,
    // unauthenticated, never-expiring public URL — anyone who ever
    // obtained that URL could view the document forever, with no way to
    // revoke access short of deleting the file. Documents often contain
    // personal info (vet records / pedigree certs print the owner's
    // name/address). Files now stay private; viewing requires
    // /api/get-signed-url, which checks the requester actually
    // owns/breeds the dog and issues a short-lived (10 min) signed URL.
    const fileUrl = null

    // Save metadata to Firestore
    const uploadedAt = new Date()
    const documentData = {
      dogId,
      tenantId: uid,
      fileName,
      fileUrl,
      filePath,
      fileType: media.fileType,
      documentType: safeDocumentType,
      uploadedAt,
      extractedData: extractedData || {},
      ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
      ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim().slice(0, 2000) } : {}),
      ...(source === 'manual' ? { source: 'manual' } : {}),
    }
    const documentRef = await db.collection('documents').add(documentData)

    return res.status(200).json({
      success: true,
      filePath,
      document: { ...documentData, id: documentRef.id, uploadedAt: uploadedAt.toISOString() },
    })
  } catch (err) {
    // Round 19: the previous version logged AND returned err.message/
    // err.code/a stack slice to the client — any of which can carry the
    // storage path, bucket name, or other config/provider detail. Never
    // echo any of it; log only a fixed operation label + allowlisted
    // code.
    logSanitizedError('upload-document', 'UPLOAD_FAILED')
    return res.status(500).json({ error: 'Upload failed' })
  }
}
