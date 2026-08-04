// api/get-showcase-media-urls.js — issues fresh, short-lived signed
// URLs for a puppy's OWN Showcase gallery, for the breeder's own
// authenticated workspace view (PuppyMediaManager in LittersPage.tsx).
//
// Needed because Codex fix-round ("Revocable media delivery") made
// api/upload-showcase-media.js store PRIVATE Storage paths instead of
// public URLs — the breeder's own gallery view can no longer render
// `dog.photos` directly, since those are never public. Right after an
// upload/reorder/delete, api/upload-showcase-media.js and
// api/update-showcase-media.js already return fresh signed URLs
// inline — this endpoint exists for every OTHER time the gallery needs
// to render (initial mount, switching to a different puppy, a page
// reload), where the client only has the puppy's own already-loaded
// Dog document (with its private paths) and needs to turn those into
// something actually viewable.
//
// Authorization mirrors api/get-signed-url.js's own precedent for
// private Storage content: the caller must be signed in AND either the
// dog's breeder (tenantId) or its current owner (currentOwnerId) — a
// plain ownership/visibility check, deliberately NOT canAddDogRecord()
// (which also blocks a restricted dog) — VIEWING your own restricted
// puppy's existing photos must still work; only NEW uploads are
// blocked for a restricted dog (api/upload-showcase-media.js).
//
// POST /api/get-showcase-media-urls
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId }
// Returns: { photos: [{id,url}], videos: [{id,url}] } | { error }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
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
    logConfigError('get-showcase-media-urls', 'STORAGE_BUCKET_NOT_CONFIGURED')
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

  const { dogId } = req.body
  if (!dogId || typeof dogId !== 'string') return res.status(400).json({ error: 'dogId is required' })

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data()

    const isAuthorized = dog.tenantId === uid || dog.currentOwnerId === uid
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to view media for this dog' })
    }

    const [photos, videos] = await Promise.all([
      signMediaItems(bucket, dog.photos || []),
      signMediaItems(bucket, dog.videos || []),
    ])
    return res.status(200).json({ photos, videos })
  } catch (err) {
    logSanitizedError('get-showcase-media-urls', 'SIGNED_URL_FAILED')
    return res.status(500).json({ error: 'Internal error' })
  }
}

export default handler
