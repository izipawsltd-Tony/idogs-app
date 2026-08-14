import { useRef, useState } from 'react'
import type { User } from 'firebase/auth'

export type PasswordResetStatus = 'available' | 'auth_unavailable' | 'unsupported_provider'

interface Props { user: User; targetUid: string; targetEmail: string; status: PasswordResetStatus; onUpdated: () => Promise<void> }

const labels: Record<PasswordResetStatus, string> = {
  available: 'Available',
  auth_unavailable: 'Auth unavailable',
  unsupported_provider: 'Unsupported provider / no password sign-in',
}

export default function SuperAdminPasswordResetAction({ user, targetUid, targetEmail, status, onUpdated }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const inFlight = useRef(false)

  const close = () => {
    if (inFlight.current) return
    setOpen(false); setReason(''); setConfirmed(false)
  }

  const submit = async () => {
    if (inFlight.current || submitting || status !== 'available' || reason.trim().length < 5 || !confirmed) return
    inFlight.current = true; setSubmitting(true); setResult(null)
    try {
      const token = await user.getIdToken()
      const response = await fetch(`/api/super-admin/users/${encodeURIComponent(targetUid)}/password-reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), confirmed: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Password reset email could not be sent')
      await onUpdated()
      setOpen(false); setReason(''); setConfirmed(false)
      setResult({ kind: 'success', message: `Password reset email sent to ${targetEmail}. The password has not been changed.` })
    } catch (error) {
      setResult({ kind: 'error', message: error instanceof Error ? error.message : 'Password reset email could not be sent' })
    } finally {
      inFlight.current = false; setSubmitting(false)
    }
  }

  return (
    <section className="super-admin-panel super-admin-verification-panel" aria-labelledby="password-reset-heading">
      <div className="super-admin-panel-header">
        <div><h3 id="password-reset-heading">Password reset support</h3><p>Send a secure reset link without viewing, setting or generating a password.</p></div>
        <span className={`super-admin-status password-reset-${status}`}>{labels[status]}</span>
      </div>
      {status === 'available' ? (
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setOpen(true); setResult(null) }} disabled={submitting}>Send password reset email</button>
      ) : (
        <button className="btn btn-secondary btn-sm" type="button" disabled>{labels[status]}</button>
      )}
      {open && status === 'available' && (
        <div className="super-admin-confirmation" role="group" aria-labelledby="password-reset-confirm-title">
          <strong id="password-reset-confirm-title">Confirm password reset email</strong>
          <p>The secure reset email will be sent to <strong className="super-admin-break-word">{targetEmail}</strong>. Sending it does not change the password.</p>
          <label>Required reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={submitting} aria-describedby="password-reset-reason-help" /></label>
          <small id="password-reset-reason-help">Enter at least 5 characters. This reason is stored in the audit trail.</small>
          <label className="super-admin-confirm-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={submitting} />I confirm a password reset email should be sent to {targetEmail}.</label>
          <div className="super-admin-confirm-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={submitting || reason.trim().length < 5 || !confirmed}>{submitting ? 'Sending...' : 'Send password reset email'}</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={close} disabled={submitting}>Cancel</button>
          </div>
        </div>
      )}
      {result && <p className={`super-admin-inline-result ${result.kind}`} role={result.kind === 'error' ? 'alert' : 'status'}>{result.message}</p>}
    </section>
  )
}
