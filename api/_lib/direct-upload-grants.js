import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAccountWrites } from './account-write-fence.js'
import { canAddDogRecord } from './dog-access.js'
import { ApiError } from './http-helpers.js'
import {
  MEDIA_UPLOAD_GRANTS_COLLECTION,
  MEDIA_UPLOAD_QUOTAS_COLLECTION,
  MAX_PENDING_UPLOADS_PER_USER,
  MAX_PENDING_UPLOADS_PER_DOG,
} from './direct-upload.js'

function quotaRefs(db, uid, dogId) {
  const dogKey = createHash('sha256').update(`${uid}:${dogId}`).digest('hex')
  return {
    user: db.collection(MEDIA_UPLOAD_QUOTAS_COLLECTION).doc(`user_${uid}`),
    dog: db.collection(MEDIA_UPLOAD_QUOTAS_COLLECTION).doc(`dog_${dogKey}`),
  }
}

export async function createPendingGrant(db, mediaId, grant) {
  const grantRef = db.collection(MEDIA_UPLOAD_GRANTS_COLLECTION).doc(mediaId)
  const refs = quotaRefs(db, grant.uid, grant.dogId)
  return db.runTransaction(async tx => {
    await requireAccountWrites(tx, db, grant.uid)
    const ownerSnap = await tx.get(db.collection('dogs').doc(grant.dogId))
    if (!ownerSnap.exists || !canAddDogRecord(ownerSnap.data(), grant.uid)) throw new ApiError(403, 'Not authorized to upload media for this dog')
    if (ownerSnap.data().status === 'transferred' || ownerSnap.data().transferStatus === 'pendingClaim') throw new ApiError(403, 'Dog transfer is pending', { reason: 'DOG_TRANSFER_IN_PROGRESS' })
    const [userSnap, dogSnap] = await Promise.all([tx.get(refs.user), tx.get(refs.dog)])
    let userCount = userSnap.exists ? Number(userSnap.data()?.pendingCount || 0) : 0
    let dogCount = dogSnap.exists ? Number(dogSnap.data()?.pendingCount || 0) : 0
    // Recover expired slots only for this authorized dog. Preview deployments
    // may not run the daily cron; waiting for it must not strand upload quota.
    // Read before writing, so issuance/confirmation/cron races retry atomically.
    // Keep expired grants as durable cleanup obligations; never delete bytes.
    let released = 0
    if (userCount >= MAX_PENDING_UPLOADS_PER_USER || dogCount >= MAX_PENDING_UPLOADS_PER_DOG) {
      const pending = await tx.get(db.collection(MEDIA_UPLOAD_GRANTS_COLLECTION)
        .where('dogId', '==', grant.dogId).where('status', '==', 'pending').limit(20))
      const now = Date.now()
      for (const doc of pending.docs) {
        const prior = doc.data()
        const expiry = Date.parse(prior.expiresAt)
        if (prior.uid !== grant.uid || !Number.isFinite(expiry) || expiry > now) continue
        tx.update(doc.ref, { status: 'expired', expiredAt: new Date(now).toISOString() })
        if (prior.quotaReserved === true) released += 1
      }
      userCount = Math.max(0, userCount - released)
      dogCount = Math.max(0, dogCount - released)
    }
    const reason = userCount >= MAX_PENDING_UPLOADS_PER_USER ? 'USER_PENDING_LIMIT'
      : dogCount >= MAX_PENDING_UPLOADS_PER_DOG ? 'DOG_PENDING_LIMIT' : null
    if (reason) {
      if (released) {
        tx.set(refs.user, { pendingCount: userCount, updatedAt: new Date() }, { merge: true })
        tx.set(refs.dog, { pendingCount: dogCount, updatedAt: new Date() }, { merge: true })
      }
      return { created: false, reason }
    }
    tx.create(grantRef, grant)
    tx.set(refs.user, { uid: grant.uid, pendingCount: userCount + 1, updatedAt: new Date() }, { merge: true })
    tx.set(refs.dog, { uid: grant.uid, dogId: grant.dogId, pendingCount: dogCount + 1, updatedAt: new Date() }, { merge: true })
    return { created: true }
  })
}

export function releasePendingQuota(tx, db, grant) {
  // Grants issued before this micro-fix did not reserve quota. Skipping
  // them avoids creating negative counters during a rolling deploy.
  if (grant.quotaReserved !== true) return
  const refs = quotaRefs(db, grant.uid, grant.dogId)
  tx.set(refs.user, { pendingCount: FieldValue.increment(-1), updatedAt: new Date() }, { merge: true })
  tx.set(refs.dog, { pendingCount: FieldValue.increment(-1), updatedAt: new Date() }, { merge: true })
}

export async function closePendingGrant(db, grantRef, status, extra = {}) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(grantRef)
    if (!snap.exists || snap.data()?.status !== 'pending') return false
    const grant = snap.data()
    tx.update(grantRef, { status, ...extra })
    releasePendingQuota(tx, db, grant)
    return true
  })
}
