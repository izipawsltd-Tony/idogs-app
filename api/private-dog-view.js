// Read-only buyer view for exactly one deposited Dog ID. Authorization is
// server-mediated: a signed-in, verified Firebase email must match the
// active dogPrivateAccess grant, and that grant must still have been issued
// by the dog's CURRENT effective owner. No litter data or sibling puppy IDs
// are returned.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { requireStorageBucket } from './_lib/require-config.js'
import { signMediaItems } from './_lib/showcase-media-access.js'
import { effectiveOwnerId, grantAllowsBuyerRead, isSafeDogDocumentPath } from './_lib/private-dog-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const PRIVATE_URL_TTL_MS = 5 * 60 * 1000

async function handler(req, res) {
  if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed')
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) throw new ApiError(401, 'Missing Authorization header')

  let decoded
  try {
    decoded = await getAuth().verifyIdToken(token)
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }
  if (!decoded.email || decoded.email_verified !== true) throw new ApiError(403, 'A verified email is required')

  const { dogId } = parseJsonBody(req)
  if (!dogId || typeof dogId !== 'string') throw new ApiError(400, 'dogId is required')

  const db = getFirestore()
  const [dogSnap, grantSnap] = await Promise.all([
    db.collection('dogs').doc(dogId).get(),
    db.collection('dogPrivateAccess').doc(dogId).get(),
  ])
  if (!dogSnap.exists || !grantSnap.exists) throw new ApiError(404, 'Private puppy access not found')

  const dog = { id: dogSnap.id, ...dogSnap.data() }
  if (effectiveOwnerId(dog) === decoded.uid) {
    return res.status(200).json({ ownedByCaller: true, dog: { id: dog.id, name: dog.name } })
  }
  if (!grantAllowsBuyerRead(grantSnap.data(), dog, decoded.email)) throw new ApiError(404, 'Private puppy access not found')

  // Do not even enumerate the dog's documents until the grant has passed.
  const documentsSnap = await db.collection('documents').where('dogId', '==', dogId).get()
  const bucketName = requireStorageBucket()
  if (!bucketName) throw new Error('Storage bucket not configured')
  const bucket = getStorage().bucket(bucketName)
  const docs = documentsSnap.docs.map(snap => {
    const data = snap.data()
    const path = data.filePath || data.storagePath || data.documentPath || null
    return isSafeDogDocumentPath(path, dog) ? { id: snap.id, path, title: data.title || null, documentType: data.documentType || 'other', fileType: data.fileType || null, uploadedAt: data.uploadedAt } : null
  }).filter(Boolean)

  const [photos, videos, signedDocs] = await Promise.all([
    signMediaItems(bucket, dog.photos || [], PRIVATE_URL_TTL_MS),
    signMediaItems(bucket, dog.videos || [], PRIVATE_URL_TTL_MS),
    signMediaItems(bucket, docs.map(d => ({ id: d.id, path: d.path })), PRIVATE_URL_TTL_MS),
  ])
  const docUrls = new Map(signedDocs.map(item => [item.id, item.url]))

  return res.status(200).json({
    ownedByCaller: false,
    dog: {
      id: dog.id,
      name: dog.name,
      breed: dog.breed,
      sex: dog.sex,
      colour: dog.colour || null,
      dateOfBirth: dog.dateOfBirth || null,
      photos,
      videos,
      documents: docs.filter(d => docUrls.has(d.id)).map(d => ({
        id: d.id,
        title: d.title,
        documentType: d.documentType,
        fileType: d.fileType,
        uploadedAt: d.uploadedAt?.toDate?.()?.toISOString() || d.uploadedAt || null,
        url: docUrls.get(d.id),
      })),
    },
  })
}

export default withApiErrorHandling('private-dog-view', handler)
