// api/upload-document.js — Vercel serverless
// Receives file as base64, uploads to Firebase Storage via Admin SDK

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'

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

  const { base64, mediaType, dogId, documentType, extractedData } = req.body

  if (!base64 || !dogId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const db = getFirestore()

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) {
      return res.status(404).json({ error: 'Dog not found' })
    }
    const dog = dogSnap.data()
    const isAuthorized = dog.tenantId === uid || dog.currentOwnerId === uid
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to upload documents for this dog' })
    }

    const ext = mediaType === 'application/pdf' ? 'pdf' : 'jpg'
    const fileName = `${documentType || 'document'}_${Date.now()}.${ext}`
    // Use the verified uid (not a client-supplied tenantId) for the path —
    // this can legitimately be the dog's breeder OR its current owner,
    // whichever account is doing the scanning.
    const filePath = `documents/${uid}/${dogId}/${fileName}`

    // Upload to Firebase Storage
    const bucket = getStorage().bucket(bucketName)
    const file = bucket.file(filePath)
    const buffer = Buffer.from(base64, 'base64')

    await file.save(buffer, {
      metadata: { contentType: mediaType || 'image/jpeg' },
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
    await db.collection('documents').add({
      dogId,
      tenantId: uid,
      fileName,
      fileUrl,
      filePath,
      fileType: ext === 'pdf' ? 'pdf' : 'image',
      documentType: documentType || 'other',
      uploadedAt: new Date(),
      extractedData: extractedData || {},
    })

    return res.status(200).json({ success: true, filePath })
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
