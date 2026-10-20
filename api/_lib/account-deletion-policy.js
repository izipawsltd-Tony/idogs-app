// Owner-approved business rules; deployment/fulfilment are separate gates.
// This module never contacts a billing provider or deletes account data.
export const DELETION_POLICY_VERSION = '2026-10-21-v1'
export const DELETION_TARGET_MS = 7 * 24 * 60 * 60 * 1000
export const RENEWAL_TASK_COLLECTION = 'accountDeletionRenewalTasks'

export function deletionCommitment(now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 - DELETION_TARGET_MS) throw new Error('invalid_deletion_clock')
  const acceptedAt = new Date(now).toISOString()
  const targetAt = new Date(now + DELETION_TARGET_MS).toISOString()
  return { policyVersion: DELETION_POLICY_VERSION, acceptedAt, targetAt, nextUpdateDueAt: targetAt }
}

export function newRenewalTask({ uid, revision, commitment }) {
  return {
    uid, revision, policyVersion: commitment.policyVersion,
    acceptedAt: commitment.acceptedAt, updatedAt: commitment.acceptedAt,
    status: 'pending_verification', cancellationMode: 'period_end',
    scope: 'verified_subscriptions_existing_at_acceptance',
    restartOnDeletionCancellation: false,
    // No provider dispatcher is enabled by a request, owner policy approval or UI.
    executionEnabled: false,
  }
}

// Explicit allowlist: never reflect provider identifiers/errors/operator notes.
export function publicDeletionCommitment(data) {
  if (data?.policyVersion !== DELETION_POLICY_VERSION) return {}
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
  return {
    targetAt: date(data.targetAt), nextUpdateDueAt: date(data.nextUpdateDueAt),
    renewalStatus: ['pending_verification', 'verified_stopped', 'verified_no_subscription', 'review_required'].includes(data.renewalStatus)
      ? data.renewalStatus : 'pending_verification',
  }
}
