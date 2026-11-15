// Operator-run account deletion (Owner decision 06 Nov 2026: complete every
// request within 7 days). Three separate super-admin actions:
//   preview        read-only plan: what will be deleted, retained or blocks
//   process        cancels web Stripe subscriptions, deletes the account's
//                  scoped Firestore data and Storage objects, deletes the Auth
//                  user and emails a confirmation; records evidence per step
//   mark_completed only RECORDS completion, and only when the evidence from
//                  `process` is complete. It never deletes anything itself.
// Dependencies are injected so the whole flow runs against emulators in tests.
import { buildDeletionInventory } from './account-deletion-inventory.js'
import { DELETION_COLLECTION } from './account-deletion.js'

export const DELETION_TARGET_DAYS = 7
const PROCESSABLE = ['requested', 'review_required', 'processing', 'processed']
const ACTIVE_STRIPE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])
// Inventory dispositions that are deleted. Everything else is retained:
// other owners' dogs and their history, billing ledgers, workflow tasks.
const DELETE = new Set(['review_account_record', 'review_owned_data', 'review_unresolved_dog'])
const RETAIN_REASON = {
  preserve_other_owner: 'Dog now owned by another account (kept with its current owner)',
  review_billing_retention: 'Payment record retained for legal/tax purposes',
  review_workflow_retention: 'Deletion workflow record',
}
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra })

function ownsLegacyDog(record, profileUid) {
  return record.disposition === 'review_legacy_ownership' && record.tenantId === profileUid
}

export async function planDeletion({ db, uid, now = Date.now() }) {
  const inventory = await buildDeletionInventory({ db, uid, limit: 500, now })
  const blockers = []
  if (inventory.errors.length) blockers.push(`Inventory queries failed: ${inventory.errors.join(', ')}`)
  if (inventory.truncated.length) blockers.push(`Inventory truncated: ${inventory.truncated.join(', ')}`)
  const pending = inventory.dogs.filter(d => d.disposition === 'review_pending_transfer').map(d => d.id)
  if (pending.length) blockers.push(`Dogs with a pending transfer must be claimed or cancelled first: ${pending.join(', ')}`)
  const tenantOf = new Map()
  for (const r of inventory.records) {
    if (!r.path.startsWith('dogs/')) continue
    const snap = await db.doc(r.path).get()
    tenantOf.set(r.path, snap.exists ? snap.data().tenantId : null)
  }
  const deleteRecords = [], retained = []
  for (const r of inventory.records) {
    if (r.path === `${DELETION_COLLECTION}/${uid}`) continue
    if (DELETE.has(r.disposition) || ownsLegacyDog({ ...r, tenantId: tenantOf.get(r.path) }, uid)) deleteRecords.push(r)
    else if (r.disposition !== 'review_pending_transfer') retained.push({ path: r.path, reason: RETAIN_REASON[r.disposition] || r.disposition })
  }
  const deletedDogIds = deleteRecords.filter(r => r.path.startsWith('dogs/')).map(r => r.path.split('/')[1])
  const storagePrefixes = deletedDogIds.flatMap(id => [`documents/${uid}/${id}/`, `dogs/${uid}/${id}/`])
  const storagePaths = [...new Set(deleteRecords.flatMap(r => r.media.paths))]
  return {
    uid, checkedAt: inventory.checkedAt, blockers,
    deletePaths: deleteRecords.map(r => r.path), retained, storagePrefixes, storagePaths,
    legacyUrlRecords: deleteRecords.filter(r => r.media.legacyUrlCount).map(r => r.path),
    billingReviewRequired: inventory.billingReviewRequired,
    notScanned: inventory.unknownCollections,
  }
}

async function cancelStripe({ stripe, profile, uid }) {
  const ids = new Set([profile?.stripeSubscriptionId, profile?.smsStripeSubscriptionId].filter(x => typeof x === 'string' && x))
  const customer = typeof profile?.stripeCustomerId === 'string' ? profile.stripeCustomerId : null
  // Fail closed: a subscription can exist only in Stripe (found by
  // metadata.userId), so billing is never "checked" without a Stripe client,
  // even when the profile has no billing ids. Nothing is deleted before this.
  if (!stripe) throw fail('Stripe is not configured; billing cannot be checked.', 503)
  if (customer) {
    const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 })
    for (const s of list.data) if (ACTIVE_STRIPE.has(s.status)) ids.add(s.id)
  }
  // Also find subscriptions by the account id that checkout writes into subscription metadata,
  // so a subscription whose webhook never reached the profile is still cancelled.
  let page
  do {
    const found = await stripe.subscriptions.search({ query: `metadata['userId']:'${uid}'`, limit: 100, ...(page ? { page } : {}) })
    for (const s of found.data) if (ACTIVE_STRIPE.has(s.status)) ids.add(s.id)
    page = found.has_more ? found.next_page : null
  } while (page)
  const cancelled = [], alreadyEnded = []
  for (const id of ids) {
    const sub = await stripe.subscriptions.retrieve(id)
    if (!ACTIVE_STRIPE.has(sub.status)) { alreadyEnded.push(id); continue }
    await stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false })
    cancelled.push(id)
  }
  return { checked: true, customer: customer ? 'present' : null, searched: true, cancelled, alreadyEnded }
}

async function deleteStorage({ bucket, plan }) {
  let deleted = 0, missing = 0
  for (const prefix of plan.storagePrefixes) {
    const [files] = await bucket.getFiles({ prefix })
    for (const f of files) { await f.delete({ ignoreNotFound: true }); deleted++ }
  }
  for (const path of plan.storagePaths) {
    const [exists] = await bucket.file(path).exists()
    if (!exists) { missing++; continue }
    await bucket.file(path).delete({ ignoreNotFound: true }); deleted++
  }
  return { deleted, missing }
}

export function deletionConfirmationEmail(name) {
  const hello = name ? `Hello ${name},` : 'Hello,'
  const text = `${hello}\n\nYour iDogs account and the personal data in it have now been deleted, as you requested. Any active iDogs Plus subscription purchased on idogs.com.au has been cancelled and will not renew.\n\nDogs you transferred to other owners stay with their current owners. We keep only records we must retain by law, such as payment records held by Stripe.\n\nIf you did not request this, reply to info@idogs.com.au.\n\nThe iDogs team`
  return { subject: 'Your iDogs account has been deleted', text }
}

const LEASE_MS = 15 * 60 * 1000
const union = (a = [], b = []) => [...new Set([...a, ...b])]

async function verifyRemoved({ db, bucket, targets }) {
  const firestoreLeft = []
  for (const path of targets.deletePaths) if ((await db.doc(path).get()).exists) firestoreLeft.push(path)
  let storageLeft = 0
  for (const prefix of targets.storagePrefixes) storageLeft += (await bucket.getFiles({ prefix }))[0].length
  for (const path of targets.storagePaths) if ((await bucket.file(path).exists())[0]) storageLeft++
  return { firestoreLeft, storageLeft }
}

export async function processDeletion({ db, auth, bucket, stripe, sendEmail, uid, operator, now = Date.now(), runId = `${now}-${Math.random().toString(36).slice(2, 10)}` }) {
  const ref = db.collection(DELETION_COLLECTION).doc(uid)
  // One run at a time: a lease taken in a transaction; a second run is refused while it is live.
  const started = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw fail('Deletion request not found.', 404)
    const data = snap.data()
    if (!PROCESSABLE.includes(data.status)) throw fail(`Request is ${data.status}; it cannot be processed.`, 409)
    if (data.lease && data.lease.runId !== runId && Date.parse(data.lease.until) > Date.now()) throw fail('This deletion is already being processed. Try again in a few minutes.', 409)
    const at = new Date(now).toISOString()
    tx.update(ref, { status: data.status === 'processed' ? 'processed' : 'processing', ...(data.processingStartedAt ? {} : { processingStartedAt: at }), processedBy: operator, updatedAt: at,
      lease: { runId, until: new Date(Date.now() + LEASE_MS).toISOString() } })
    return data
  })
  const evidence = { ...(started.evidence || {}) }
  let targets = started.targets || null
  // Every write re-checks that this run still holds the lease.
  const save = (fields = {}) => db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data() || {}
    if (cur.lease?.runId !== runId) throw fail('Another run took over this deletion; this run stopped.', 409)
    tx.update(ref, { evidence, ...(targets ? { targets } : {}), updatedAt: new Date().toISOString(), lease: { runId, until: new Date(Date.now() + LEASE_MS).toISOString() }, ...fields })
  })
  const release = (fields = {}) => save({ lease: null, ...fields }).catch(() => {})

  try {
    const dataDone = evidence.auth === 'deleted' && evidence.verification?.passed === true
    if (!dataDone) {
      const profileSnap = await db.collection('users').doc(uid).get()
      const profile = profileSnap.exists ? profileSnap.data() : null
      let authUser = null
      try { authUser = await auth.getUser(uid) } catch (e) { if (e?.code !== 'auth/user-not-found') throw e }
      if (!evidence.contactEmail) {
        evidence.contactEmail = (profile?.email || authUser?.email || '').trim() || null
        // Greet by real name only; quick sign-up display names are often the email prefix.
        const display = (authUser?.displayName || '').trim()
        evidence.contactName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim()
          || (display && !/[@+]/.test(display) && display.toLowerCase() !== (evidence.contactEmail || '').split('@')[0].toLowerCase() ? display : null)
      }
      const plan = await planDeletion({ db, uid, now })
      if (!targets) {
        // First run: blockers apply, and the cleanup targets are saved BEFORE anything is
        // deleted, so a retry after a partial failure still knows every original file.
        if (plan.blockers.length) {
          evidence.blockers = plan.blockers
          await release({ status: 'review_required' })
          throw fail('Deletion needs review before it can run.', 409, { blockers: plan.blockers })
        }
        targets = { deletePaths: plan.deletePaths, storagePrefixes: plan.storagePrefixes, storagePaths: plan.storagePaths,
          retained: plan.retained, notScanned: plan.notScanned, legacyUrlRecords: plan.legacyUrlRecords.length, capturedAt: new Date().toISOString() }
      } else {
        // Retry: keep every saved target and add anything that appeared since.
        targets = { ...targets, deletePaths: union(targets.deletePaths, plan.deletePaths), storagePrefixes: union(targets.storagePrefixes, plan.storagePrefixes), storagePaths: union(targets.storagePaths, plan.storagePaths) }
      }
      delete evidence.blockers
      await save()
      // 1. Billing first: never delete the account while a web subscription could renew.
      if (evidence.stripe?.checked !== true) {
        try { evidence.stripe = await cancelStripe({ stripe, profile, uid }) }
        catch { evidence.stripe = { checked: false, error: 'stripe_failed' }; await release({ status: evidence.firestore ? 'processing' : 'review_required' }); throw fail('Stripe subscription could not be checked or cancelled. Nothing more was deleted.', 502) }
      }
      // Freeze writes: sign the account out everywhere before data is removed.
      if (authUser && !evidence.signInFrozen) { await auth.updateUser(uid, { disabled: true }); await auth.revokeRefreshTokens(uid) }
      evidence.signInFrozen = true
      await save()
      // 2. Data (subcollections included), 3. files. Both idempotent over the saved targets.
      for (const path of targets.deletePaths) await db.recursiveDelete(db.doc(path))
      evidence.firestore = { deleted: targets.deletePaths.length, retained: targets.retained, notScanned: targets.notScanned, legacyUrlRecords: targets.legacyUrlRecords }
      await save()
      const removed = await deleteStorage({ bucket, plan: targets })
      evidence.storage = { deleted: (evidence.storage?.deleted || 0) + removed.deleted, missing: removed.missing }
      // 4. Verify nothing in scope is left before the sign-in is deleted or anyone is emailed.
      const left = await verifyRemoved({ db, bucket, targets })
      if (left.firestoreLeft.length || left.storageLeft) {
        evidence.verification = { passed: false, firestoreLeft: left.firestoreLeft.length, storageLeft: left.storageLeft }
        await release()
        throw fail('Some data or files are still present. Run Process again.', 500)
      }
      evidence.verification = { passed: true, checkedAt: new Date().toISOString() }
      await save()
      try { await auth.deleteUser(uid) } catch (e) { if (e?.code !== 'auth/user-not-found') throw e }
      evidence.auth = 'deleted'
      evidence.dataDeletedAt = new Date().toISOString()
      await save({ status: 'processed' })
    }
    if (evidence.email === 'sent' || evidence.email === 'no_email') {
      await release({ status: 'processed' })
      return { status: 'processed', evidence }
    }
    // 5. Confirmation email (idempotent per account).
    if (!evidence.contactEmail) evidence.email = 'no_email'
    else {
      try { await sendEmail({ to: evidence.contactEmail, idempotencyKey: `account-deletion-v1/${uid}`, ...deletionConfirmationEmail(evidence.contactName) }); evidence.email = 'sent'; evidence.emailSentAt = new Date().toISOString() }
      catch { evidence.email = 'failed' }
    }
    await release({ status: 'processed' })
    return { status: 'processed', evidence }
  } catch (error) {
    if (!error?.status) { evidence.lastError = { at: new Date().toISOString(), message: 'step_failed' }; await release() }
    throw error
  }
}

export async function markDeletionCompleted({ db, uid, operator, now = Date.now() }) {
  const ref = db.collection(DELETION_COLLECTION).doc(uid)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw fail('Deletion request not found.', 404)
    const data = snap.data(), e = data.evidence || {}
    if (data.status === 'completed') return { status: 'completed', completedAt: data.completedAt }
    const missing = []
    if (data.status !== 'processed') missing.push('process step not finished')
    if (e.stripe?.checked !== true) missing.push('Stripe check')
    if (!e.firestore) missing.push('data deletion')
    if (!e.storage) missing.push('file deletion')
    if (e.verification?.passed !== true) missing.push('removal check')
    if (e.auth !== 'deleted') missing.push('sign-in deletion')
    if (!['sent', 'no_email'].includes(e.email)) missing.push('confirmation email')
    if (missing.length) throw fail(`Cannot record completion yet: ${missing.join(', ')}.`, 409, { missing })
    const at = new Date(now).toISOString()
    tx.update(ref, { status: 'completed', completedAt: at, completedBy: operator, updatedAt: at })
    return { status: 'completed', completedAt: at }
  })
}
