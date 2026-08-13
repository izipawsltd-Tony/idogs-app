import { useRef, useState } from 'react'
import type { User } from 'firebase/auth'

export type EmailVerificationStatus = 'verified' | 'not_verified' | 'unavailable'

interface Props {
  user: User
  targetUid: string
  targetEmail: string
  status: EmailVerificationStatus
  onUpdated: () => Promise<void>
}

const statusLabel: Record<EmailVerificationStatus, string> = {
  verified: 'Verified',
  not_verified: 'Not verified',
  unavailable: 'Auth account unavailable',
}

export default function SuperAdminEmailVerificationAction({ user, targetUid, targetEmail, status, onUpdated }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const inFlight = useRef(false)

  const close = () => {
    if (inFlight.current) return
    setOpen(false)
    setReason('')
    setConfirmed(false)
  }

  const submit = async () => {
    if (inFlight.current || submitting || reason.trim().length < 5 || !confirmed || status !== 'not_verified') return
    inFlight.current = true
    setSubmitting(true)
    setResult(null)
    try {
      const token = await user.getIdToken()
      const response = await fetch(`/api/super-admin/users/${encodeURIComponent(targetUid)}/verification-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), confirmed: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Verification email could not be sent')
      await onUpdated()
      setOpen(false)
      setReason('')
      setConfirmed(false)
      setResult({ kind: 'success', message: `Verification email sent to ${targetEmail}.` })
    } catch (error) {
      setResult({ kind: 'error', message: error instanceof Error ? error.message : 'Verification email could not be sent' })
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <section className="super-admin-panel super-admin-verification-panel" aria-labelledby="email-verification-heading">
      <div className="super-admin-panel-header">
        <div>
          <h3 id="email-verification-heading">Email verification support</h3>
          <p>Send a new Firebase verification link through the trusted iDogs email service.</p>
        </div>
        <span className={`super-admin-status verification-${status}`}>{statusLabel[status]}</span>
      </div>

      {status === 'verified' ? (
        <button className="btn btn-secondary btn-sm" type="button" disabled>Already verified</button>
      ) : status === 'unavailable' ? (
        <button className="btn btn-secondary btn-sm" type="button" disabled>Auth account unavailable</button>
      ) : (
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setOpen(true); setResult(null) }} disabled={submitting}>
          Resend verification email
        </button>
      )}

      {open && status === 'not_verified' && (
        <div className="super-admin-confirmation" role="group" aria-labelledby="verification-confirm-title">
          <strong id="verification-confirm-title">Confirm verification email</strong>
          <p>The email will be sent to <strong className="super-admin-break-word">{targetEmail}</strong>. The account will remain unverified until the user opens the secure Firebase link.</p>
          <label>
            Required reason
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={500}
              disabled={submitting}
              aria-describedby="verification-reason-help"
            />
          </label>
          <small id="verification-reason-help">Enter at least 5 characters. This reason is stored in the audit trail.</small>
          <label className="super-admin-confirm-checkbox">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={submitting} />
            I confirm a verification email should be sent to {targetEmail}.
          </label>
          <div className="super-admin-confirm-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={submitting || reason.trim().length < 5 || !confirmed}>
              {submitting ? 'Sending...' : 'Send verification email'}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={close} disabled={submitting}>Cancel</button>
          </div>
        </div>
      )}

      {result && <p className={`super-admin-inline-result ${result.kind}`} role={result.kind === 'error' ? 'alert' : 'status'}>{result.message}</p>}
    </section>
  )
}
