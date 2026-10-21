// Read the server-owned fence in the SAME transaction as the protected write.
// A standalone preflight read is insufficient: freeze could commit between it
// and the mutation. This helper does not enable any deletion processing.
import { ApiError } from './http-helpers.js'

export async function accountWritesAllowed(tx, db, uid) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) return false
  const snap = await tx.get(db.collection('accountDeletionFences').doc(uid))
  return !snap.exists || snap.data()?.state === 'open'
}

export async function requireAccountWrites(tx, db, uid) {
  if (!await accountWritesAllowed(tx, db, uid)) {
    throw Object.assign(new ApiError(409, 'Account changes are paused while deletion is being processed.',
      { reason: 'ACCOUNT_WRITES_FROZEN' }), { code: 'account_writes_frozen' })
  }
}

// Owner comes from the committed dog, never tenantId supplied by the caller.
// A transferred dog's old breeder fence must not stop its new owner's scans.
export async function recordPassportScan({ db, dogId, passportId, now = Date.now }) {
  if (typeof dogId !== 'string' || !dogId || dogId.includes('/') || typeof passportId !== 'string' || !passportId) return false
  const dogRef = db.collection('dogs').doc(dogId), logRef = db.collection('scanLogs').doc()
  return db.runTransaction(async tx => {
    const dogSnap = await tx.get(dogRef), dog = dogSnap.data()
    if (!dogSnap.exists || dog.passportId !== passportId) return false
    const owner = Object.hasOwn(dog, 'currentOwnerId') ? dog.currentOwnerId : dog.tenantId
    if (!await accountWritesAllowed(tx, db, owner)) return false
    tx.create(logRef, { dogId, passportId, scannedAt: new Date(now()).toISOString(), result: 'public_view' })
    return true
  })
}
