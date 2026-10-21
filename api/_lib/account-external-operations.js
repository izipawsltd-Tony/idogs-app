import { accountWritesAllowed, requireAccountWrites } from './account-write-fence.js'
import { ApiError } from './http-helpers.js'

// A provider cannot participate in Firestore's commit. Journal admission before
// dispatch; unresolved/ambiguous calls block deletion, regardless of age. Never
// persist provider payloads here and never automatically replay an unknown call.
export async function requireReminderScope(tx, db, uid, dogId) {
  await requireAccountWrites(tx, db, uid)
  const user = await tx.get(db.collection('users').doc(uid))
  if (!user.exists || user.data().emailReminders === false) throw new ApiError(409, 'Reminders paused')
  if (dogId) {
    const dog = (await tx.get(db.collection('dogs').doc(dogId))).data()
    const owner = dog && (Object.hasOwn(dog, 'currentOwnerId') ? dog.currentOwnerId : dog.tenantId)
    if (owner !== uid || dog.status === 'transferred' || dog.transferStatus === 'pendingClaim' || dog.isDeceased) throw new ApiError(409, 'Reminders paused')
  }
}

export async function dispatchAccountOperation({ db, uid, dogId = null, kind, invoke, operationKey, validate, confirmed = () => true }) {
  if (operationKey !== undefined && !/^[a-f0-9]{64}$/.test(operationKey)) throw new Error('INVALID_OPERATION_KEY')
  const operations = db.collection('accountExternalOperations')
  const ref = operationKey ? operations.doc(operationKey) : operations.doc()
  const check = async tx => {
    if (kind.startsWith('reminder_')) await requireReminderScope(tx, db, uid, dogId)
    else await requireAccountWrites(tx, db, uid)
    if (validate) await validate(tx)
  }
  await db.runTransaction(async tx => {
    await check(tx)
    const prior = await tx.get(ref)
    if (prior.exists) throw new ApiError(409, 'Delivery already admitted', { reason: 'DELIVERY_ALREADY_ADMITTED' })
    tx.set(ref, { uid, dogId, kind, state: 'dispatching', startedAt: new Date().toISOString() })
  })
  // Recheck after admission: a freeze that won before dispatch cancels the
  // call. A freeze after this check sees a durable drain hold, never 'gone'.
  try { await db.runTransaction(check) } catch (error) {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (snap.exists) tx.update(ref, { state: 'cancelled', finishedAt: new Date().toISOString() })
    })
    throw error
  }
  let result, failure
  try { result = await invoke() } catch (error) { failure = error }
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    // Never recreate a deleted workflow record on a late provider response.
    if (snap.exists) tx.update(ref, { state: !failure && confirmed(result) ? 'settled' : 'review_required', finishedAt: new Date().toISOString() })
  })
  if (failure) throw failure
  return result
}

// Background writes re-read both account and committed dog ownership. A stale
// cron snapshot cannot recreate deleted data or mutate a transferred dog.
export async function writeReminderRecord({ db, uid, dogId, ref, data, merge = false, update = false }) {
  return db.runTransaction(async tx => {
    await requireReminderScope(tx, db, uid, dogId)
    const snap = await tx.get(ref)
    if (snap.exists && snap.data().tenantId && snap.data().tenantId !== uid) return false
    if (snap.exists && snap.data().dogId && snap.data().dogId !== dogId) return false
    if (update && !snap.exists) return false
    if (!update && snap.data()?.status === 'completed') return false
    if (update) tx.update(ref, data)
    else tx.set(ref, data, { merge })
    return true
  })
}

// Verified webhooks retain a minimal reconciliation receipt outside the user
// profile. Deletion is never permission to reactivate entitlements or recreate
// PII. Receipts require financial-retention review, not silent replay on reopen.
export async function billingAccountWritable(tx, db, uid, event) {
  if (await accountWritesAllowed(tx, db, uid)) return true
  if (event?.id) {
    const ref = db.collection('accountBillingEvents').doc(event.id)
    const old = await tx.get(ref)
    if (!old.exists) tx.set(ref, { uid, type: event.type, state: 'review_required', recordedAt: new Date().toISOString() })
  }
  return false
}
