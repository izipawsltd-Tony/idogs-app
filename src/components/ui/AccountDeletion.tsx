import { useRef, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { useAuth } from '../../hooks/useAuth'
import { PolicyReviewNotice, DeletionPolicyDraft, BillingPolicyDraft, RetentionPolicyDraft } from '../legal/PolicyReview'

interface Status {
  status: string
  canCancel: boolean
  requestedAt?: string
  message?: string
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
              {status.requestedAt && <p>Requested: {new Date(status.requestedAt).toLocaleString()}</p>}
            </>}
          </div>
          {status && (status.canCancel || ['none', 'cancelled'].includes(status.status)) && (
            <form onSubmit={e => { e.preventDefault(); if (status.canCancel || confirmed) void call(status.canCancel ? 'cancel' : 'request') }}>
              <label htmlFor="delete-account-password">Confirm your password</label>
              <input id="delete-account-password" type="password" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} required disabled={busy} />
              {!status.canCancel && <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />
                I understand this requests permanent account deletion. I can cancel only before processing starts.
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
