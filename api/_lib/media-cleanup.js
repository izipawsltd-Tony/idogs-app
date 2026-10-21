import { createHash } from 'node:crypto'

export const MEDIA_CLEANUP_TASKS = 'mediaCleanupTasks'
// Queue only. A removed gallery reference or closed grant is NOT proof that
// transferred history, another reference, a live PUT or retained versions are
// safe to delete. No unversioned delete is issued by request or cron paths.
export async function queueMediaCleanupTx(tx, db, { uid, dogId, bucket, path, generation = null, source, expiresAt = null }) {
  if (!uid || !dogId || !bucket || typeof path !== 'string'
      || !(path.split('/')[0] === 'dogs' && path.split('/')[1] && path.split('/')[2] === dogId) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('INVALID_CLEANUP_SCOPE')
  const version = typeof generation === 'string' && /^[1-9][0-9]*$/.test(generation) ? generation : null
  const key = createHash('sha256').update(JSON.stringify([bucket, path, version, source])).digest('hex')
  const ref = db.collection(MEDIA_CLEANUP_TASKS).doc(key)
  const prior = await tx.get(ref)
  if (!prior.exists) tx.set(ref, { uid, dogId, bucket, path, generation: version, source, expiresAt,
    state: 'review_required', reason: version ? 'SHARED_REFERENCE_AND_VERSION_REVIEW' : 'GENERATION_UNVERIFIED', createdAt: new Date().toISOString() })
  return key
}

export async function queueGrantCleanup({ db, grantRef, bucket }) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(grantRef)
    if (!snap.exists || !['expired', 'rejected', 'duplicate'].includes(snap.data().status)) return false
    const grant = snap.data()
    await queueMediaCleanupTx(tx, db, { ...grant, bucket, source: `grant:${grantRef.id}` })
    tx.update(grantRef, { status: 'cleanup_review' })
    return true
  })
}
