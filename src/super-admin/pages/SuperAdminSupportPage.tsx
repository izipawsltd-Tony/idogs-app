import { useState, useEffect, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface SignalRow {
  id: string
  createdAt: string | null
  action: string
  details: string
  tenantId: string | null
  dogName: string | null
  performedBy: string | null
  performedByEmail: string | null
  tenantIsOrganisation: boolean
}

interface RecentAccount {
  uid: string
  email: string
  role: string
  plan: string
  createdAt: string | null
}

interface Summary {
  totalSupportItems: number
  recentSignalsCount: number
  recentAccountsCount: number
}

interface ApiResponse {
  supportItems: unknown[]
  signals: SignalRow[]
  recentAccounts: RecentAccount[]
  summary: Summary
  dataModelNotice: string
}

const disabledCardStyle: CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: '#f4f6f5',
  color: '#9aa39d',
  cursor: 'not-allowed',
}

export default function SuperAdminSupportPage() {
  const { user } = useAuth()
  const [signals, setSignals] = useState<SignalRow[]>([])
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [dataModelNotice, setDataModelNotice] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchSupport() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/support', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true)
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('The server returned a non-JSON response.')
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}))
        throw new Error(errorJson.message || `HTTP error ${res.status}`)
      }

      const json: ApiResponse = await res.json()
      setSignals(Array.isArray(json.signals) ? json.signals : [])
      setRecentAccounts(Array.isArray(json.recentAccounts) ? json.recentAccounts : [])
      setSummary(json.summary || null)
      setDataModelNotice(json.dataModelNotice || '')
    } catch (err: any) {
      console.error('Error fetching support signals:', err)
      setError(err.message || 'Failed to connect to the support API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSupport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const formatDateTime = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      return new Date(isoString).toLocaleString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: 'Australia/Adelaide',
      })
    } catch {
      return isoString
    }
  }

  const formatDate = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      return new Date(isoString).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Adelaide',
      })
    } catch {
      return isoString
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading support signals...</p>
      </div>
    )
  }

  if (unauthorized) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: '#ffffff', border: '1px solid #dfe5df', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(16,41,29,0.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Access Denied</h3>
        <p style={{ color: '#53635a', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          Your account does not possess Super Admin permissions. This console is restricted to authorized platform operators only.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: '#ffffff', border: '1px solid #dfe5df', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(16,41,29,0.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Connection Error</h3>
        <p style={{ color: '#c53030', fontSize: 13, wordBreak: 'break-word', lineHeight: 1.6, marginBottom: 20 }}>{error}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={fetchSupport}
          style={{ background: '#10291d', borderColor: '#10291d', color: '#fff', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Retry Connection
        </button>
      </div>
    )
  }

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ marginBottom: 20 }}>
        <p className="super-admin-kicker">Operations</p>
        <h2>Support</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Support-related platform signals — no formal ticket system yet.
        </p>
      </section>

      <div style={{
        padding: '12px 16px',
        background: '#fdf3dc',
        border: '1px solid #f0e2b8',
        borderRadius: 8,
        color: '#7a5b0c',
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: 12,
        fontWeight: 600,
      }}>
        🔒 Read-only support workspace. Reply, assign, resolve, and close actions are disabled in V1.
      </div>

      {dataModelNotice && (
        <div style={{
          padding: '12px 16px',
          background: '#eef5f0',
          border: '1px solid #dfe5df',
          borderRadius: 8,
          color: '#1a3a2a',
          fontSize: 12,
          lineHeight: 1.5,
          marginBottom: 24,
        }}>
          ℹ️ <strong>Data model note:</strong> {dataModelNotice}
        </div>
      )}

      {/* Summary Cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>SUPPORT TICKETS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{summary?.totalSupportItems ?? 0}</h3>
          <p style={{ margin: '4px 0 0' }}>No formal ticket collection yet</p>
        </div>
        <div className="super-admin-module-card">
          <span>RECENT SIGNALS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{summary?.recentSignalsCount ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>RECENT ACCOUNTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>{summary?.recentAccountsCount ?? 0}</h3>
        </div>
      </section>

      {/* Future support workflow — disabled */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Support Workflow</h3>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled title="Coming later" style={disabledCardStyle}>Support Inbox — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledCardStyle}>Reply from Super Admin — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledCardStyle}>Assign ticket — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledCardStyle}>Resolve/Close ticket — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledCardStyle}>Email integration — Coming later</button>
        </div>
      </div>

      {/* Recent signals table */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Recent Platform Signals</h3>
          <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
            Sourced from Audit Logs
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {signals.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No recent platform activity to show.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Time</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Actor Email</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Action</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Target</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Organisation</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {signals.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                    <td style={{ padding: '10px 8px', color: '#53635a', whiteSpace: 'nowrap' }}>{formatDateTime(s.createdAt)}</td>
                    <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{s.performedByEmail || s.performedBy || 'System'}</td>
                    <td style={{ padding: '10px 8px' }}>{s.action}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{s.dogName || '—'}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{s.tenantId ? `${s.tenantId.slice(0, 8)}…` : '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {s.performedBy && (
                          <Link to={`/app/super-admin/users/${s.performedBy}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                            View User
                          </Link>
                        )}
                        {s.tenantId && s.tenantIsOrganisation && (
                          <Link to={`/app/super-admin/organisations/${s.tenantId}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                            View Org
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent accounts table */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Recently Registered Accounts</h3>
          <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
            For manual inspection
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {recentAccounts.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No accounts to show.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Plan</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentAccounts.map(a => (
                  <tr key={a.uid} style={{ borderBottom: '1px solid #f4f6f5' }}>
                    <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{a.email}</td>
                    <td style={{ padding: '10px 8px' }}>{a.role}</td>
                    <td style={{ padding: '10px 8px' }}>{a.plan}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{formatDate(a.createdAt)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <Link to={`/app/super-admin/users/${a.uid}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                        View User
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
