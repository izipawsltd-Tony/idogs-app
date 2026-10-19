// Request lifecycle only. Never deletes data or mutates subscriptions.
export const DELETION_COLLECTION = 'accountDeletionRequests'
export const CANCELLABLE = ['requested', 'review_required']
const fail = (message, status) => Object.assign(new Error(message), { status })

export function requireRecentAuthentication(token, now = Date.now()) {
  const age = now / 1000 - Number(token.auth_time)
  if (!Number.isFinite(age) || age < -30 || age > 300) {
    throw fail('Please sign in again before requesting account deletion.', 401)
  }
}

export function deletionStatus(data) {
  if (!data) return { status: 'none', canCancel: false }
  return {
    status: data.status,
    requestedAt: data.requestedAt,
    updatedAt: data.updatedAt,
    canCancel: CANCELLABLE.includes(data.status),
    // No internal notes, identity, billing identifiers or inventory leaks.
    message: data.status === 'cancelled' ? 'Your deletion request was cancelled.'
      : data.status === 'completed' ? 'Your account deletion has completed.'
        : data.status === 'processing' ? 'Account deletion is being processed. Cancellation is no longer available.'
          : 'Your request is saved for review. Your account has not been deleted. You can cancel before processing begins.',
  }
}

export async function changeDeletionRequest({ db, token, body, now = Date.now() }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(k => !['action', 'confirmation'].includes(k))) {
    throw fail('Invalid request.', 400)
  }
  if (!['request', 'cancel'].includes(body.action)) throw fail('Invalid action.', 400)
  requireRecentAuthentication(token, now)
  if (body.action === 'request' && body.confirmation !== 'DELETE MY ACCOUNT') {
    throw fail('Explicit account deletion confirmation is required.', 400)
  }
  const ref = db.collection(DELETION_COLLECTION).doc(token.uid)
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const previous = snap.exists ? snap.data() : null
    if (body.action === 'cancel') {
      if (previous?.status === 'cancelled') return previous
      if (!previous || !CANCELLABLE.includes(previous.status)) throw fail('This request cannot be cancelled.', 409)
      const next = { ...previous, status: 'cancelled', updatedAt: new Date(now).toISOString() }
      tx.set(ref, next)
      return next
    }
    // Duplicate requests are receipts, never a second job or reset of processing.
    if (previous && previous.status !== 'cancelled') return previous
    if (previous && now - Date.parse(previous.updatedAt) < 60000) throw fail('Please wait a minute before requesting again.', 429)
    const next = {
      uid: token.uid, status: 'requested', revision: Number(previous?.revision || 0) + 1,
      requestedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      mode: 'as_soon_as_possible', policyVersion: '2026-10-19-v2',
      // Explicitly tracked holds; no fabricated deletion deadline or paid action.
      holds: ['ownership_inventory', 'billing_review', 'write_freeze_verification'],
    }
    tx.set(ref, next)
    return next
  })
  return deletionStatus(result)
}

// Conservative classification. A tenant match never authorizes deletion.
export function classifyDeletionDog(dog, uid) {
  if (dog.transferStatus === 'pendingClaim' || dog.status === 'transferred') return 'review_pending_transfer'
  if (dog.currentOwnerId && dog.currentOwnerId !== uid) return 'preserve_other_owner'
  if (!dog.currentOwnerId) return 'review_legacy_ownership'
  return dog.currentOwnerId === uid ? 'review_owned_data' : 'unrelated'
}
