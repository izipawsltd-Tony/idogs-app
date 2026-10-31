import { withAccountMutationFence } from './_lib/deletion-fence.js'
// api/get-signed-url.js — Issues a short-lived signed URL for a private
// Storage file, after verifying the requesting user actually owns/breeds
// the dog the document belongs to.
//
// Replaces the old pattern of storing a permanent public Storage URL
// (file.makePublic()) — see upload-document.js for why that was risky.
// Files are now private; the client must call this endpoint each time it
// wants to view one, with a valid Firebase Auth ID token.
//
// POST /api/get-signed-url
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { filePath: "documents/{tenantId}/{dogId}/{fileName}" }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
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

const SIGNED_URL_TTL_MS = 10 * 60 * 1000 // 10 minutes

  async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Fail closed BEFORE any Firebase/Storage request, and before even
  // verifying the caller's token — a missing/malformed
  // FIREBASE_STORAGE_BUCKET must never be papered over by silently
  // targeting production, regardless of who's asking.
  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('get-signed-url', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  // 1. Verify the caller is signed in
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

  const { filePath } = req.body
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath required' })
  }

  // 2. Parse tenantId/dogId out of the known path shape
  // documents/{tenantId}/{dogId}/{fileName}
  const parts = filePath.split('/')
  if (parts.length < 4 || parts[0] !== 'documents') {
    return res.status(400).json({ error: 'Unrecognised filePath shape' })
  }
  const [, pathTenantId, dogId] = parts
  if (!pathTenantId || !dogId) {
    return res.status(400).json({ error: 'Unrecognised filePath shape (empty segments)' })
  }

  try {
    // 3. Verify the caller actually owns/breeds this dog — either as
    // the breeder (tenantId match) or the current owner. Never trust
    // pathTenantId alone, since the client could send any filePath; the
    // real check is against the dog document itself.
    const dogSnap = await getFirestore().collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) {
      return res.status(404).json({ error: 'Dog not found' })
    }
    const dog = dogSnap.data()
    const isCurrentOwner = (Object.prototype.hasOwnProperty.call(dog, 'currentOwnerId')
      ? dog.currentOwnerId === uid
      : dog.tenantId === uid)

    let historicalPathAllowed = false
    if (!isCurrentOwner) {
      const historySnap = await getFirestore().collection('ownershipHistorySnapshots')
        .where('dogId', '==', dogId)
        .where('fromOwnerId', '==', uid)
        .get()
      historicalPathAllowed = historySnap.docs.some(s =>
        (s.data().documents || []).some(d => d.filePath === filePath || d.storagePath === filePath)
      )
    }

    if (!isCurrentOwner && !historicalPathAllowed) {
      return res.status(403).json({ error: 'Not authorized to view this document' })
    }

    // Current-owner paths must belong to one of the dog's known owner
    // namespaces. Historical viewers are authorized only by exact path
    // membership in their immutable snapshot above.
    if (isCurrentOwner && pathTenantId !== dog.tenantId && pathTenantId !== dog.currentOwnerId) {
      return res.status(403).json({ error: 'Path does not match dog record' })
    }

    // 4. Issue the signed URL
    const bucket = getStorage().bucket(bucketName)
    const file = bucket.file(filePath)
    const [exists] = await file.exists()
    if (!exists) {
      return res.status(404).json({ error: 'File not found' })
    }

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    })

    return res.status(200).json({ url, expiresInSeconds: SIGNED_URL_TTL_MS / 1000 })
  } catch (err) {
    // Round 19: never echo err.message (a GCS SDK error can embed the
    // bucket/file path) to the client, and log only a fixed operation
    // label + allowlisted code — never the raw error.
    logSanitizedError('get-signed-url', 'SIGNED_URL_FAILED')
    return res.status(500).json({ error: 'Internal error' })
  }
}

export default withAccountMutationFence(handler, { route: 'api/get-signed-url.js' })
