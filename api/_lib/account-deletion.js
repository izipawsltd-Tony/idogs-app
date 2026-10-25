// Request lifecycle only. Never deletes data or mutates subscriptions.
import { deletionCommitment, newRenewalTask, publicDeletionCommitment, RENEWAL_TASK_COLLECTION } from './account-deletion-policy.js'
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
  const stages = ['checking', 'waiting_for_writes', 'waiting_for_storage', 'review_required', 'removing_data', 'verifying', 'completed']
  const dates = Object.fromEntries(['targetAt', 'nextUpdateDueAt', 'completedAt'].filter(key => typeof data[key] === 'string' && Number.isFinite(Date.parse(data[key]))).map(key => [key,data[key]]))
  return {
    status: data.status,
    requestedAt: data.requestedAt,
    updatedAt: data.updatedAt,
    canCancel: CANCELLABLE.includes(data.status),
    ...publicDeletionCommitment(data),
    ...dates,
    ...(stages.includes(data.processingStage) ? { processingStage: data.processingStage } : {}),
    ...(data.status==='processing'&&data.processingStage==='waiting_for_storage'&&typeof data.storageReviewAfter==='string'&&Number.isFinite(Date.parse(data.storageReviewAfter))?{storageReviewAfter:data.storageReviewAfter}:{}),
    ...(['pending_verification','review_required','verified_stopped','verified_no_subscription'].includes(data.renewalStatus) ? {renewalStatus:data.renewalStatus} : {}),
    ...(data.status === 'completed' && Array.isArray(data.retainedCategories) ? {retainedCategories:data.retainedCategories.filter(v => ['current_owner_history','reviewed_financial_record','reviewed_history'].includes(v))} : {}),
    // No internal notes, identity, billing identifiers or inventory leaks.
    message: data.status === 'cancelled' ? 'Your deletion request was cancelled.'
      : data.status === 'completed' ? 'Your account deletion has completed.'
        : data.status === 'processing' ? 'Account deletion is being processed. Cancellation is no longer available.'
          : 'Your request is saved for review. Your account has not been deleted. You can cancel before processing begins.',
  }
}

export async function changeDeletionRequest({ db, token, body, now = Date.now(), onRequestAccepted }) {
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
  const conversationRef = db.collection('supportConversations').doc(`account_deletion_${token.uid}`)
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const previous = snap.exists ? snap.data() : null
    if (body.action === 'cancel') {
      if (previous?.status === 'cancelled') return previous
      if (!previous || !CANCELLABLE.includes(previous.status)) throw fail('This request cannot be cancelled.', 409)
      const conversation = await tx.get(conversationRef)
      const next = { ...previous, status: 'cancelled', updatedAt: new Date(now).toISOString() }
      tx.set(ref, next)
      if (conversation.exists) tx.set(conversationRef, { ...conversation.data(),
        status: 'closed', updatedAt: next.updatedAt, lastMessageAt: next.updatedAt,
        lastMessagePreview: 'Account deletion request cancelled by the account holder.',
        adminUnreadCount: Number(conversation.data().adminUnreadCount || 0) + 1,
      })
      tx.set(db.collection('supportMessages').doc(`account_deletion_${token.uid}_${previous.revision}_cancel`), {
        conversationId: conversationRef.id, senderUid: token.uid, senderType: 'user',
        text: 'Account deletion request cancelled. Do not process this request.', createdAt: next.updatedAt,
      })
      return next
    }
    // Duplicate requests are receipts, never a second job or reset of processing.
    if (previous && previous.status !== 'cancelled') return previous
    if (previous && now - Date.parse(previous.updatedAt) < 60000) throw fail('Please wait a minute before requesting again.', 429)
    const conversation = await tx.get(conversationRef)
    const commitment = deletionCommitment(now)
    const next = {
      uid: token.uid, status: 'requested', revision: Number(previous?.revision || 0) + 1,
      requestedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      mode: 'as_soon_as_possible', ...commitment,
      renewalStatus: 'pending_verification',
      // A service target is not a completion receipt or billing cancellation.
      holds: ['ownership_inventory', 'billing_review', 'write_freeze_verification'],
      supportConversationId: conversationRef.id,
    }
    tx.set(ref, next)
    // The task and receipt commit atomically. Duplicate requests do not reset
    // dates or enqueue another task. Cancellation preserves this task and never
    // requests a subscription restart. Provider execution remains disabled.
    tx.set(db.collection(RENEWAL_TASK_COLLECTION).doc(`${token.uid}_${next.revision}`),
      newRenewalTask({ uid: token.uid, revision: next.revision, commitment }))
    const message = 'Account deletion requested. Review ownership, pending transfers, billing and record retention before processing. No permanent deletion is confirmed.'
    tx.set(conversationRef, {
      ...(conversation.exists ? conversation.data() : {}),
      ownerUid: token.uid, ownerEmail: token.email || null, ownerName: token.name || null,
      organisationId: null, organisationName: null,
      subject: 'Account deletion request', category: 'account_deletion', status: 'new',
      assigneeUid: null, assigneeEmail: null,
      createdAt: conversation.exists ? conversation.data().createdAt : next.requestedAt,
      updatedAt: next.updatedAt, lastMessageAt: next.updatedAt, lastMessagePreview: message,
      adminUnreadCount: Number(conversation.data()?.adminUnreadCount || 0) + 1,
      userUnreadCount: Number(conversation.data()?.userUnreadCount || 0),
    })
    tx.set(db.collection('supportMessages').doc(`account_deletion_${token.uid}_${next.revision}_request`), {
      conversationId: conversationRef.id, senderUid: token.uid, senderType: 'user',
      text: message, createdAt: next.requestedAt,
    })
    return next
  })
  if(body.action==='request'&&onRequestAccepted&&CANCELLABLE.includes(result.status)){
    await onRequestAccepted({uid:token.uid,revision:result.revision})
    const latest=await ref.get()
    return deletionStatus(latest.exists?latest.data():result)
  }
  return deletionStatus(result)
}

// Conservative classification. A tenant match never authorizes deletion.
export function classifyDeletionDog(dog, uid) {
  if (dog.transferStatus === 'pendingClaim' || dog.status === 'transferred') return 'review_pending_transfer'
  if (dog.currentOwnerId && dog.currentOwnerId !== uid) return 'preserve_other_owner'
  if (!dog.currentOwnerId) return 'review_legacy_ownership'
  return dog.currentOwnerId === uid ? 'review_owned_data' : 'unrelated'
}
