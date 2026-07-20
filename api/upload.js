// api/upload.js — unified photo upload endpoint.
//
// Merges the former api/upload-photo.js + api/upload-note-photo.js into
// one function to stay within Vercel's Hobby plan limit of 12 serverless
// functions. Differentiated via ?type= query param:
//
//   ?type=profile (default) — dog's profile picture. Fixed path
//     (dogs/{uid}/{dogId}/profile.{ext}), OVERWRITES on every call,
//     and updates the dog's `profilePhoto` field in Firestore.
//
//   ?type=note — a photo attached to an ActivityNote (timeline/story
//     entry). Unique filename per upload (a dog can have many note
//     photos over its lifetime). Does NOT touch profilePhoto or write
//     anything to Firestore — the client saves the returned fileUrl onto
//     the note itself separately.
//
// Kept as two clearly-separate branches rather than unified logic, to
// preserve exactly the separation upload-note-photo.js was originally
// created to guarantee: a note upload must never be able to silently
// overwrite the dog's profile photo.
//
// SECURITY FIX: previously trusted dogId/userId straight from the
// request body with no auth check — anyone who knew/guessed a dogId
// could overwrite another breeder's dog's profile photo. Now requires a
// valid Firebase ID token and verifies the caller owns/breeds the dog.

import sharp from 'sharp'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'

// Bounded staging-isolation safety patch: storageBucket is intentionally
// NOT passed here anymore — it used to fall back to
// `${FIREBASE_PROJECT_ID}.firebasestorage.app`, and ultimately to the
// hardcoded PRODUCTION bucket name if even FIREBASE_PROJECT_ID was
// missing. The bucket is now resolved explicitly, per request, via
// requireStorageBucket() below and passed directly to
// getStorage().bucket(name) at the point of use — never defaulted here.
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const uploadType = req.query.type === 'note' ? 'note' : 'profile'

  // Fail closed BEFORE any Firebase/Storage request, and before even
  // verifying the caller's token — a missing/malformed
  // FIREBASE_STORAGE_BUCKET must never be papered over by silently
  // targeting production, regardless of who's asking.
  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('upload', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

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

  const { base64, mediaType, dogId } = req.body
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
      return res.status(403).json({ error: 'Not authorized to upload photos for this dog' })
    }

    const bucket = getStorage().bucket(bucketName)
    let buffer = Buffer.from(base64, 'base64')
    let finalMediaType = mediaType || 'image/jpeg'

    if (finalMediaType === 'image/heic' || finalMediaType === 'image/heif') {
      buffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer()
      finalMediaType = 'image/jpeg'
    }

    const ext = finalMediaType === 'image/png' ? 'png' : finalMediaType === 'image/webp' ? 'webp' : 'jpg'

    if (uploadType === 'note') {
      // ── Note photo: unique filename, no Firestore writes here ──
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const filePath = `dogs/${uid}/${dogId}/notes/${uniqueName}`
      const file = bucket.file(filePath)

      await file.save(buffer, { metadata: { contentType: finalMediaType } })
      await file.makePublic()

      const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`
      return res.status(200).json({ success: true, fileUrl })
    }

    // ── Profile photo: fixed path, overwrites on every call, updates dog.profilePhoto ──
    const filePath = `dogs/${uid}/${dogId}/profile.${ext}`
    const file = bucket.file(filePath)

    await file.save(buffer, { metadata: { contentType: finalMediaType } })
    await file.makePublic()

    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}?t=${Date.now()}`

    await db.collection('dogs').doc(dogId).update({
      profilePhoto: fileUrl,
      updatedAt: new Date(),
    })

    return res.status(200).json({ success: true, fileUrl })
  } catch (err) {
    // Round 19: never echo String(err) (a GCS SDK error can embed the
    // bucket/file path) to the client, and log only a fixed operation
    // label + allowlisted code — never the raw error. uploadType is one
    // of exactly two server-controlled values (never raw request text).
    logSanitizedError(`upload (${uploadType})`, 'UPLOAD_FAILED')
    return res.status(500).json({ error: 'Upload failed' })
  }
}
