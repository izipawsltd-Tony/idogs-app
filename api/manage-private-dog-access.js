// Breeder-managed, pre-transfer private access for one deposited puppy.
// The grant never changes Dog ownership and never grants client Firestore
// access. A buyer's verified email is checked server-side by
// api/private-dog-view.js on every load.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { canGrantPrivateDogAccess, canManagePrivateDogAccess, normalizeBuyerEmail } from './_lib/private-dog-access.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

function publicGrant(grant) {
  if (!grant || grant.status !== 'active') return null
  return {
    buyerEmail: grant.buyerEmail,
    status: 'active',
    grantedAt: grant.grantedAt?.toDate?.()?.toISOString() || grant.grantedAt || null,
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed')
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) throw new ApiError(401, 'Missing Authorization header')

  let uid
  try {
    uid = (await getAuth().verifyIdToken(token)).uid
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }

  const { dogId, action = 'get', buyerEmail } = parseJsonBody(req)
  if (!dogId || typeof dogId !== 'string') throw new ApiError(400, 'dogId is required')
  if (!['get', 'grant', 'revoke'].includes(action)) throw new ApiError(400, 'Invalid action')

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)
  const grantRef = db.collection('dogPrivateAccess').doc(dogId)

  if (action === 'get') {
    const [dogSnap, grantSnap] = await Promise.all([dogRef.get(), grantRef.get()])
    if (!dogSnap.exists) throw new ApiError(404, 'Dog not found')
    if (!canManagePrivateDogAccess(dogSnap.data(), uid)) throw new ApiError(403, 'Not authorized')
    return res.status(200).json({ grant: grantSnap.exists ? publicGrant(grantSnap.data()) : null })
  }

  if (action === 'grant') {
    const email = normalizeBuyerEmail(buyerEmail)
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new ApiError(400, 'A valid buyer email is required')

    const result = await db.runTransaction(async tx => {
      const dogSnap = await tx.get(dogRef)
      if (!dogSnap.exists) return { status: 404, error: 'Dog not found' }
      const dog = dogSnap.data()
      if (!canManagePrivateDogAccess(dog, uid)) return { status: 403, error: 'Not authorized' }
      if (!canGrantPrivateDogAccess(dog, uid)) return { status: 409, error: 'Deposit must be marked received before private access can be granted', reason: 'DEPOSIT_NOT_RECEIVED' }
      tx.set(grantRef, {
        dogId,
        buyerEmail: email,
        grantedByUid: uid,
        status: 'active',
        grantedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { status: 200 }
    })
    if (result.error) throw new ApiError(result.status, result.error, result.reason ? { reason: result.reason } : {})
    const snap = await grantRef.get()
    return res.status(200).json({ grant: publicGrant(snap.data()) })
  }

  const result = await db.runTransaction(async tx => {
    const dogSnap = await tx.get(dogRef)
    if (!dogSnap.exists) return { status: 404, error: 'Dog not found' }
    if (!canManagePrivateDogAccess(dogSnap.data(), uid)) return { status: 403, error: 'Not authorized' }
    const grantSnap = await tx.get(grantRef)
    if (grantSnap.exists) {
      tx.update(grantRef, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    }
    return { status: 200 }
  })
  if (result.error) throw new ApiError(result.status, result.error)
  return res.status(200).json({ grant: null })
}

export default withApiErrorHandling('manage-private-dog-access', handler)
