import { useState } from 'react'
import type { User } from 'firebase/auth'

export interface AdminAccountState {
  authExists: boolean
  access: 'active' | 'suspended' | 'missing'
  disabled: boolean | null
}

export interface AdminEntitlementState {
  granted: boolean
  reason: string | null
  expiresAt: string | null
  grantedAt: string | null
  grantedBy: string | null
  revokedAt: string | null
  revokedBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

type Action = 'suspend_account' | 'reactivate_account' | 'grant_entitlement' | 'update_entitlement' | 'revoke_entitlement'

interface Props {
  user: User
  targetUid: string
  targetLabel: string
  accountState: AdminAccountState
  entitlement: AdminEntitlementState | null
  entitlementActive: boolean
  superAdminAuthorized: boolean
  onUpdated: () => Promise<void> | void
}

const labels: Record<Action, string> = {
  suspend_account: 'Suspend account access',
  reactivate_account: 'Reactivate account access',
  grant_entitlement: 'Grant internal entitlement',
  update_entitlement: 'Update internal entitlement',
  revoke_entitlement: 'Revoke internal entitlement',
}

export default function SuperAdminAccountOperations({ user, targetUid, targetLabel, accountState, entitlement, entitlementActive, superAdminAuthorized, onUpdated }: Props) {
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const begin = (next: Action) => {
    setAction(next)
    setReason('')
    setExpiresAt(next === 'update_entitlement' && entitlement?.expiresAt ? entitlement.expiresAt.slice(0, 16) : '')
    setConfirmed(false)
    setResult(null)
  }

  const cancel = () => {
    if (submitting) return
    setAction(null)
    setReason('')
    setConfirmed(false)
  }

  const submit = async () => {
    if (!action || submitting || reason.trim().length < 5 || !confirmed) return
    setSubmitting(true)
    setResult(null)
    try {
      const token = await user.getIdToken()
      const body: Record<string, string | null> = { action, reason: reason.trim() }
      if (action === 'grant_entitlement' || action === 'update_entitlement') {
        body.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null
      }
      const response = await fetch(`/api/super-admin/users/${encodeURIComponent(targetUid)}/operations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Operation failed (${response.status})`)
      await onUpdated()
      setResult({ kind: 'success', message: `${labels[action]} completed and audited.` })
      setAction(null)
      setReason('')
      setConfirmed(false)
    } catch (error) {
      setResult({ kind: 'error', message: error instanceof Error ? error.message : 'Operation failed' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="super-admin-panel" style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Controlled Operations</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <strong>Account access</strong>
          <div style={{ marginTop: 5, color: accountState.access === 'suspended' ? '#991b1b' : '#085041', textTransform: 'capitalize' }}>{accountState.access}</div>
        </div>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <strong>Internal entitlement</strong>
          <div style={{ marginTop: 5, color: entitlementActive ? '#085041' : '#53635a' }}>{entitlementActive ? 'Active' : entitlement?.granted === false ? 'Revoked' : 'Not granted'}</div>
          {entitlement?.expiresAt && <small>Expires {new Date(entitlement.expiresAt).toLocaleString('en-AU')}</small>}
        </div>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <strong>Super Admin authorization</strong>
          <div style={{ marginTop: 5, color: superAdminAuthorized ? '#7c2d12' : '#53635a' }}>{superAdminAuthorized ? 'Allowlisted' : 'Standard account'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {accountState.authExists && accountState.access === 'active' && <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('suspend_account')}>Suspend access</button>}
        {accountState.authExists && accountState.access === 'suspended' && <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('reactivate_account')}>Reactivate access</button>}
        {!entitlementActive && <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('grant_entitlement')}>Grant entitlement</button>}
        {entitlementActive && <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('update_entitlement')}>Update entitlement</button>}
        {entitlementActive && <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('revoke_entitlement')}>Revoke entitlement</button>}
      </div>

      {action && (
        <div role="dialog" aria-modal="true" aria-label={labels[action]} style={{ marginTop: 16, padding: 16, border: '1px solid #d7b45a', borderRadius: 8, background: '#fffbeb' }}>
          <strong>{labels[action]}</strong>
          <p style={{ fontSize: 13 }}>Target: {targetLabel}. This privileged action is server-side and will create an audit record.</p>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>
            Required reason
            <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={submitting} style={{ display: 'block', width: '100%', minHeight: 72, marginTop: 5 }} />
          </label>
          {(action === 'grant_entitlement' || action === 'update_entitlement') && (
            <label style={{ display: 'block', marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              Expiry (optional)
              <input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} disabled={submitting} style={{ display: 'block', marginTop: 5 }} />
            </label>
          )}
          <label style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={submitting} />
            I confirm this action for {targetLabel} and understand it will be audited.
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={submitting || reason.trim().length < 5 || !confirmed}>{submitting ? 'Applying…' : 'Confirm action'}</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={cancel} disabled={submitting}>Cancel</button>
          </div>
        </div>
      )}

      {result && <p role="status" style={{ margin: '12px 0 0', color: result.kind === 'success' ? '#085041' : '#b91c1c', fontWeight: 600 }}>{result.message}</p>}
    </div>
  )
}
