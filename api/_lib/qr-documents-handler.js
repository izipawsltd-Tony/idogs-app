import { ApiError, parseJsonBody } from './http-helpers.js'
import { canPublish, ownerId, validId } from './puppy-updates-policy.js'
import { isSafeDogDocumentPath } from './private-dog-access.js'
import { checkRateLimit, hashClientKey, getClientIp } from './rate-limit.js'

const fileTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export function safeQrDocument(data, dog) {
  const path = data?.filePath || data?.storagePath || data?.documentPath
  const mime = typeof path === 'string' && fileTypes[path.split('.').at(-1)?.toLowerCase()]
  const parts = typeof path === 'string' ? path.split('/') : []
  return data?.dogId === dog.id && parts.length === 4 && parts.every(part => part && !['.', '..'].includes(part) && !/[\\%\x00-\x1f]/.test(part)) && isSafeDogDocumentPath(path, dog) && mime ? { path, mime } : null
}
const liveGrant = (dog, grant) => !!ownerId(dog) && grant?.ownerId === ownerId(dog) && dog.status !== 'transferred' && dog.transferStatus !== 'pendingClaim'

// Explicit public selections live in a server-only collection. No client
// document flag or old owner's grant can make a file public after transfer.
export function createQrDocumentsHandler({ db, verifyToken, timestamp, serve }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new ApiError(405, 'Method not allowed')
    const limit = checkRateLimit(hashClientKey('qr-documents:' + getClientIp(req)))
    if (!limit.allowed) { res.setHeader('Retry-After', String(limit.retryAfterSeconds)); throw new ApiError(429, 'Too many requests') }
    const body = req.method === 'POST' ? parseJsonBody(req) : req.query || {}
    if (req.method === 'POST') {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
      if (!token) throw new ApiError(401, 'Sign in to manage shared documents')
      let identity
      try { identity = await verifyToken(token) } catch { throw new ApiError(401, 'Please sign in again') }
      if (identity.email_verified !== true) throw new ApiError(403, 'Verify your email to manage shared documents')
      if (!validId(body.dogId)) throw new ApiError(400, 'Choose a dog')
      const dogRef = db.collection('dogs').doc(body.dogId), grantRef = db.collection('dogQrDocuments').doc(body.dogId)
      if (!['manage', 'save'].includes(body.action)) throw new ApiError(400, 'Choose a valid action')
      if (body.action === 'save' && (!Array.isArray(body.documentIds) || body.documentIds.length > 40 || body.documentIds.some(id => !validId(id)))) throw new ApiError(400, 'Select up to 40 documents')
      const result = await db.runTransaction(async tx => {
        const dogSnap = await tx.get(dogRef)
        const dog = dogSnap.exists ? { ...dogSnap.data(), id: dogSnap.id } : null
        if (!dog || !canPublish(dog, identity.uid)) throw new ApiError(403, 'Only the current owner can share these documents')
        const grant = (await tx.get(grantRef)).data()
        if (body.action === 'manage') return { documentIds: liveGrant(dog, grant) ? grant.documentIds || [] : [] }
        const ids = [...new Set(body.documentIds)]
        for (const id of ids) {
          const doc = await tx.get(db.collection('documents').doc(id))
          if (!doc.exists || !safeQrDocument(doc.data(), dog)) throw new ApiError(400, 'Only this dog’s stored PDF and image documents can be shared')
        }
        tx.set(grantRef, { ownerId: identity.uid, documentIds: ids, updatedAt: timestamp() })
        // Response after commit below; transaction callbacks may be retried.
        return { documentIds: ids }
      })
      return res.status(200).json(result)
    }
    if (!validId(body.passportId) || (body.documentId && !validId(body.documentId))) throw new ApiError(400, 'Choose a valid profile')
    const found = await db.collection('dogs').where('passportId', '==', body.passportId).limit(1).get()
    if (found.empty) throw new ApiError(404, 'Profile not found')
    const dog = { ...found.docs[0].data(), id: found.docs[0].id }
    const grantRef = db.collection('dogQrDocuments').doc(dog.id)
    const grant = (await grantRef.get()).data()
    const ids = liveGrant(dog, grant) && Array.isArray(grant.documentIds) ? grant.documentIds.filter(validId).slice(0, 40) : []
    if (body.documentId) {
      const docRef = db.collection('documents').doc(body.documentId)
      const data = (await docRef.get()).data(), file = safeQrDocument(data, dog)
      if (!ids.includes(body.documentId) || !file) throw new ApiError(404, 'Document is not shared')
      // Check again just before bytes leave Storage. No reusable signed URL.
      return serve(req, res, file, async () => {
        const [latestDog, latestGrant, latestDoc] = await Promise.all([db.collection('dogs').doc(dog.id).get(), grantRef.get(), docRef.get()])
        const currentDog = latestDog.exists ? { ...latestDog.data(), id: dog.id } : null
        const currentGrant = latestGrant.data(), currentFile = currentDog && safeQrDocument(latestDoc.data(), currentDog)
        if (!currentDog || !liveGrant(currentDog, currentGrant) || !currentGrant.documentIds?.includes(body.documentId) || currentFile?.path !== file.path) throw new ApiError(404, 'Document is not shared')
      })
    }
    const documents = (await Promise.all(ids.map(async id => {
      const doc = (await db.collection('documents').doc(id).get()).data()
      return safeQrDocument(doc, dog) ? { id, title: String(doc.name || doc.title || 'Shared document').slice(0, 160), url: `/api/qr-documents?passportId=${encodeURIComponent(body.passportId)}&documentId=${encodeURIComponent(id)}` } : null
    }))).filter(Boolean)
    return res.status(200).json({ documents })
  }
}
