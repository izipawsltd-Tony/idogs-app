import { useRef, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { useAuth } from '../../hooks/useAuth'
import { PolicyReviewNotice, DeletionPolicyDraft, BillingPolicyDraft, RetentionPolicyDraft } from '../legal/PolicyReview'

interface Status {
  status: string
  canCancel: boolean
  requestedAt?: string
  message?: string
  targetAt?: string
  nextUpdateDueAt?: string
  renewalStatus?: string
  processingStage?: string
  completedAt?: string
  storageReviewAfter?: string
  retainedCategories?: string[]
}

const stageCopy: Record<string,string> = {
  checking: 'Checking ownership, billing and data safeguards. Your account has not been deleted.',
  waiting_for_writes: 'Waiting for changes or uploads already in progress to finish. Deletion is not complete.',
  waiting_for_storage: 'Account data has been removed from active use. Deleted files are still within the storage recovery period. Deletion is not complete.',
  review_required: 'A safeguard needs review before processing can continue. Deletion is not complete.',
  removing_data: 'Removing account data. Deletion is not complete yet.',
  verifying: 'Checking the result before confirming completion.',
  completed: 'Account deletion has completed.',
}

const renewalCopy: Record<string, string> = {
  pending_verification: 'Stopping future renewal is pending verification. No subscription cancellation is confirmed yet.',
  review_required: 'Subscription renewal needs review. No subscription cancellation is confirmed yet.',
  verified_stopped: 'Future renewal has been verified as stopped for the subscriptions checked for this request.',
  verified_no_subscription: 'No subscription requiring cancellation was found in the verified provider check for this request.',
}
const displayDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : null

export default function AccountDeletion() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function call(action?: 'request' | 'cancel') {
    if (!user || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    // Clear the UI copy immediately; never persist credentials.
    const currentPassword = password
    setPassword('')
    try {
      if (action) {
        if (!user.email || !currentPassword) throw new Error('Enter your password to confirm this action.')
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword))
      }
      const idToken = await user.getIdToken(!!action)
      // Once a status read or mutation starts, the previous receipt is stale.
      // A lost response may follow a committed request/cancellation on the server.
      setStatus(null)
      setConfirmed(false)
      const response = await fetch('/api/account-deletion', {
        method: action ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${idToken}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify({ action, ...(action === 'request' ? { confirmation: 'DELETE MY ACCOUNT' } : {}) }) } : {}),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || typeof result.status !== 'string' || typeof result.canCancel !== 'boolean') {
        throw new Error(response.status === 401 ? 'Please sign in again and retry.' : 'The deletion service is unavailable. Request status is not confirmed; refresh to check before retrying.')
      }
      setStatus(result)
      setConfirmed(false)
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code?.startsWith('auth/') ? 'Unable to verify your password. Please sign in again if needed and retry.'
        : err instanceof Error ? err.message : 'Request failed. Refresh to check its status.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  function close() {
    setOpen(false)
    setPassword('')
    setConfirmed(false)
    setError('')
  }

  return (
    <section className="card" aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading" style={{ fontSize: 16 }}>Delete account</h2>
      <p>Request permanent deletion of your iDogs account and associated personal data.</p>
      {!open ? <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); void call() }}>Delete account…</button> : (
        <div>
          <PolicyReviewNotice />
          <DeletionPolicyDraft />
          <details><summary>Subscriptions, refunds and retained records</summary>
            <BillingPolicyDraft />
            <RetentionPolicyDraft />
          </details>
          {error && <p role="alert">{error}</p>}
          <div aria-live="polite" aria-label="Account deletion request status">
            {busy ? <p role="status">Checking…</p> : status && <>
              <p><strong>Status: {status.status === 'none' ? 'No request' : status.status.replaceAll('_', ' ')}</strong></p>
              {status.message && <p>{status.message}</p>}
              {status.processingStage && stageCopy[status.processingStage] && <p>{stageCopy[status.processingStage]}</p>}
              {status.status === 'completed' && displayDate(status.completedAt) && <p>Completed: {displayDate(status.completedAt)}</p>}
              {status.status === 'completed' && status.retainedCategories?.length ? <p>Some reviewed financial or shared ownership records remain retained with restricted access. Completion does not mean every historical record or backup was erased.</p> : null}
              {status.requestedAt && <p>Requested: {new Date(status.requestedAt).toLocaleString()}</p>}
              {status.status === 'processing' && status.processingStage === 'waiting_for_storage' && displayDate(status.storageReviewAfter) && <p>Storage verification can resume after: {displayDate(status.storageReviewAfter)}. This is a review time, not confirmation that every copy has been erased.</p>}
              {!['cancelled', 'completed'].includes(status.status) && <>
                {displayDate(status.targetAt) && <p>Processing target: {displayDate(status.targetAt)}. This is a service target, not confirmation of completion.</p>}
                {displayDate(status.nextUpdateDueAt) && <p>Next update due: {displayDate(status.nextUpdateDueAt)}</p>}
              </>}
              {status.renewalStatus && renewalCopy[status.renewalStatus] && <p>{renewalCopy[status.renewalStatus]}</p>}
            </>}
          </div>
          {status && (status.canCancel || ['none', 'cancelled'].includes(status.status)) && (
            <form onSubmit={e => { e.preventDefault(); if (status.canCancel || confirmed) void call(status.canCancel ? 'cancel' : 'request') }}>
              {status.canCancel && <p>Cancelling this request does not restart subscription renewal already stopped for this request.</p>}
              <label htmlFor="delete-account-password">Confirm your password</label>
              <input id="delete-account-password" type="password" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} required disabled={busy} />
              {!status.canCancel && <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />
                I understand this requests permanent account deletion. I can cancel only before processing starts. Cancelling this request does not restart subscription renewal already stopped for this request.
              </label>}
              <button type="submit" className="btn btn-secondary" style={{ marginTop: 12 }} disabled={busy || !password || (!status.canCancel && !confirmed)}>
                {status.canCancel ? 'Cancel deletion request' : 'Confirm deletion request'}
              </button>
            </form>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void call()}>Refresh status</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
