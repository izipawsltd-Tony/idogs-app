import { useRef, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { useAuth } from '../../hooks/useAuth'
import { DeletionPolicyDraft, BillingPolicyDraft } from '../legal/PolicyReview'

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
  pending_verification: 'Any iDogs Plus subscription bought on idogs.com.au is cancelled when we process the deletion.',
  review_required: 'We are checking your subscription before deleting. It is cancelled before any data is deleted.',
  verified_stopped: 'Future renewal has been verified as stopped for the subscriptions checked for this request.',
  verified_no_subscription: 'No subscription requiring cancellation was found in the verified provider check for this request.',
}
const displayDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : null

// Show what the server actually said (its error texts are written for account
// holders) plus the HTTP code, so a failure on a device can be diagnosed from
// a screenshot instead of a generic "unavailable".
export function deletionFailureMessage(httpStatus: number, body: unknown): string {
  if (httpStatus === 401) return 'Please sign in again and retry.'
  const raw = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  const serverText = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 404 && serverText) return `${serverText} (HTTP ${httpStatus})`
  return `The deletion service is unavailable (HTTP ${httpStatus || 'no response'}${serverText ? `: ${serverText}` : ''}). Request status is not confirmed; refresh to check before retrying.`
}

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
        throw new Error(deletionFailureMessage(response.status, result))
      }
      setStatus(result)
      setConfirmed(false)
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code?.startsWith('auth/') ? 'Unable to verify your password. Please sign in again if needed and retry.'
        : err instanceof TypeError ? `Couldn't reach iDogs (${err.message || 'network error'}). Request status is not confirmed; refresh to check before retrying.`
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
    <section className="card" aria-labelledby="delete-account-heading" style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere', boxSizing: 'border-box' }}>
      <h2 id="delete-account-heading" style={{ fontSize: 16 }}>Delete account</h2>
      <p>Request permanent deletion of your iDogs account and associated personal data.</p>
      {!open ? <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); void call() }}>Delete account…</button> : (
        <div>
          <DeletionPolicyDraft />
          <details><summary>Subscriptions and refunds</summary>
            <BillingPolicyDraft />
          </details>
          {error && <p role="alert">{error}</p>}
          <div aria-live="polite" aria-label="Account deletion request status">
            {busy ? <p role="status">Checking…</p> : status && <>
              <p><strong>Status: {status.status === 'none' ? 'No request' : status.status === 'processed' ? 'processing' : status.status.replaceAll('_', ' ')}</strong></p>
              {status.message && <p>{status.message}</p>}
              {status.processingStage && stageCopy[status.processingStage] && <p>{stageCopy[status.processingStage]}</p>}
              {status.status === 'completed' && displayDate(status.completedAt) && <p>Completed: {displayDate(status.completedAt)}</p>}
              {status.status === 'completed' && status.retainedCategories?.length ? <p>Some reviewed financial or shared ownership records remain retained with restricted access. Completion does not mean every historical record or backup was erased.</p> : null}
              {displayDate(status.requestedAt) && <p>Requested: {displayDate(status.requestedAt)}</p>}
              {status.status === 'processing' && status.processingStage === 'waiting_for_storage' && displayDate(status.storageReviewAfter) && <p>Storage verification can resume after: {displayDate(status.storageReviewAfter)}. This is a review time, not confirmation that every copy has been erased.</p>}
              {!['cancelled', 'completed'].includes(status.status) && <>
                {displayDate(status.targetAt) && <p>Deletion due by: {displayDate(status.targetAt)}</p>}
              </>}
              {status.renewalStatus && renewalCopy[status.renewalStatus] && <p>{renewalCopy[status.renewalStatus]}</p>}
            </>}
          </div>
          {status && (status.canCancel || ['none', 'cancelled'].includes(status.status)) && (
            <form onSubmit={e => { e.preventDefault(); if (status.canCancel || confirmed) void call(status.canCancel ? 'cancel' : 'request') }}>
              <label htmlFor="delete-account-password">Confirm your password</label>
              <input id="delete-account-password" type="password" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} required disabled={busy} style={{ display: 'block', width: '100%', maxWidth: 360, boxSizing: 'border-box', marginTop: 4 }} />
              {!status.canCancel && <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />
                I understand my account and data will be permanently deleted within 7 days. I can cancel until processing starts.
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
