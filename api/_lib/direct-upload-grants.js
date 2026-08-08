import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
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
    const [userSnap, dogSnap] = await Promise.all([tx.get(refs.user), tx.get(refs.dog)])
    const userCount = userSnap.exists ? Number(userSnap.data()?.pendingCount || 0) : 0
    const dogCount = dogSnap.exists ? Number(dogSnap.data()?.pendingCount || 0) : 0
    if (userCount >= MAX_PENDING_UPLOADS_PER_USER) return { created: false, reason: 'USER_PENDING_LIMIT' }
    if (dogCount >= MAX_PENDING_UPLOADS_PER_DOG) return { created: false, reason: 'DOG_PENDING_LIMIT' }
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
