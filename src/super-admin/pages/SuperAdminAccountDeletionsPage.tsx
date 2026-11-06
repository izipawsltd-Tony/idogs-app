import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface DeletionRequest { uid: string; status: string; requestedAt?: string; targetAt?: string; evidence?: Record<string, unknown> }
interface Plan { blockers: string[]; deletePaths: string[]; retained: { path: string; reason: string }[]; storagePrefixes: string[]; storagePaths: string[]; notScanned: string[] }

const statusLabel: Record<string, string> = {
  requested: 'Requested', review_required: 'Needs review', processing: 'Processing', processed: 'Deleted — confirm completion',
}

// Order matters: Preview → Process deletion → Mark completed. "Mark completed"
// only records completion; the server refuses it until every step has evidence.
export default function SuperAdminAccountDeletionsPage() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<DeletionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [env, setEnv] = useState<Record<string, string | boolean | null> | null>(null)

  const call = useCallback(async (method: 'GET' | 'POST', body?: Record<string, string>) => {
    const token = await user!.getIdToken()
    const r = await fetch('/api/super-admin/account-deletions', { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const payload = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error([payload.error || `Request failed (${r.status})`, ...(payload.blockers || []), ...(payload.missing ? [`Missing: ${payload.missing.join(', ')}`] : [])].join(' '))
    return payload
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRequests((await call('GET')).requests || [])
      const token = await user!.getIdToken()
      const r = await fetch('/api/super-admin/account-deletions?environment=1', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) setEnv((await r.json()).environment)
    } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }) } finally { setLoading(false) }
  }, [call])
  useEffect(() => { if (user) load() }, [user, load])

  const run = async (action: 'preview' | 'process' | 'mark_completed', uid: string, emailRetry = false) => {
    setBusy(true); setMessage(null)
    try {
      // An email retry happens after data is already gone, so it carries the confirmation itself.
      const out = await call('POST', { action, uid, ...(action === 'process' ? { confirmation: emailRetry ? `DELETE ${uid}` : confirm.trim() } : {}) })
      if (action === 'preview') { setPlan(out.plan); setSelected(uid) }
      if (action === 'process') { setConfirm(''); setMessage({ kind: out.evidence?.email === 'sent' || out.evidence?.email === 'no_email' ? 'success' : 'error', text: out.evidence?.email === 'failed' ? 'Data and sign-in deleted. Confirmation email failed — run Process again to retry the email.' : 'Deletion processed and confirmation email sent. Check the evidence, then mark completed.' }) }
      if (action === 'mark_completed') { setSelected(null); setPlan(null); setMessage({ kind: 'success', text: `Completion recorded at ${new Date(out.completedAt).toLocaleString('en-AU')}.` }) }
      await load()
    } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="super-admin-page-header"><div><span className="super-admin-kicker">Operations</span><h2>Account Deletions</h2><p>Complete each request within 7 days: preview, process, then record completion.</p></div></div>
      {env && <p data-testid="deletion-environment" style={{ fontSize: 12, color: 'var(--mid)', margin: '0 0 10px' }}>Systems: {String(env.vercelEnv)} · Firebase {String(env.firebaseProject)} · Storage {String(env.storageBucket)} · Stripe {String(env.stripeMode)} · Email {env.emailConfigured ? 'configured' : 'not configured'}</p>}
      {message && <div role="status" className="super-admin-panel" style={{ padding: 12, marginBottom: 12, color: message.kind === 'error' ? '#991b1b' : '#085041' }}>{message.text}</div>}
      <section className="super-admin-panel" style={{ padding: 16 }}>
        {loading ? <p role="status">Loading…</p> : requests.length === 0 ? <p>No open deletion requests.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Account</th><th align="left">Status</th><th align="left">Requested</th><th align="left">Due</th><th /></tr></thead>
            <tbody>{requests.map(r => (
              <tr key={r.uid} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>{r.uid}</td>
                <td>{statusLabel[r.status] || r.status}</td>
                <td>{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('en-AU') : '—'}</td>
                <td>{r.targetAt ? new Date(r.targetAt).toLocaleDateString('en-AU') : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.status === 'processed' && r.evidence?.email === 'failed' && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => run('process', r.uid, true)} style={{ marginRight: 6 }}>Retry email</button>}
                  {r.status === 'processed'
                    ? <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run('mark_completed', r.uid)}>Mark completed</button>
                    : <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => run('preview', r.uid)}>Preview</button>}
                </td>
              </tr>))}</tbody>
          </table>)}
      </section>
      {selected && plan && (
        <section className="super-admin-panel" style={{ padding: 16, marginTop: 12 }} aria-label="Deletion preview">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Preview for {selected}</h3>
          {plan.blockers.length > 0 && <div style={{ color: '#991b1b' }}><strong>Blocked:</strong><ul>{plan.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
          <p><strong>{plan.deletePaths.length}</strong> records and <strong>{plan.storagePrefixes.length / 2}</strong> dog file folders (+{plan.storagePaths.length} referenced files) will be deleted, then the sign-in. Active web Stripe subscriptions are cancelled first.</p>
          {plan.retained.length > 0 && <details><summary>{plan.retained.length} records kept</summary><ul style={{ fontSize: 12 }}>{plan.retained.map(r => <li key={r.path}>{r.path} — {r.reason}</li>)}</ul></details>}
          {plan.notScanned.length > 0 && <p style={{ fontSize: 12 }}>Collections not tied to accounts (not scanned): {plan.notScanned.join(', ')}</p>}
          {plan.blockers.length === 0 && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #d7b45a', borderRadius: 8, background: '#fffbeb' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>Type <code>DELETE {selected}</code> to process
                <input value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} style={{ display: 'block', width: '100%', marginTop: 5 }} />
              </label>
              <button className="btn btn-danger btn-sm" style={{ marginTop: 10 }} type="button" disabled={busy || confirm.trim() !== `DELETE ${selected}`} onClick={() => run('process', selected)}>{busy ? 'Processing…' : 'Process deletion'}</button>
            </div>)}
        </section>)}
    </div>
  )
}
