import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface SubscriptionRow {
  uid: string
  accountName: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  trialStatus: string | null
  trialEndsAt: string | null
  smsAddon: boolean
  estimatedMonthlyValue: number
  isActivePaid: boolean
  registeredAt: string | null
  lastSignInTime: string | null
}

interface Summary {
  totalAccounts: number
  trialAccounts: number
  activePaidAccounts: number
  freeAccounts: number
  smsAddonAccounts: number
  estimatedMrr: number
}

interface ApiResponse {
  subscriptions: SubscriptionRow[]
  summary: Summary
  dataModelNotice: string
}

export default function SuperAdminSubscriptionsPage() {
  const { user } = useAuth()
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [dataModelNotice, setDataModelNotice] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  const [searchEmail, setSearchEmail] = useState('')
  const [filterPlan, setFilterPlan] = useState<string>('all')

  async function fetchSubscriptions() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/subscriptions', {
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
      setSubscriptions(Array.isArray(json.subscriptions) ? json.subscriptions : [])
      setSummary(json.summary || null)
      setDataModelNotice(json.dataModelNotice || '')
    } catch (err: any) {
      console.error('Error fetching subscriptions data:', err)
      setError(err.message || 'Failed to connect to the subscriptions API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubscriptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const formatDate = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      return new Date(isoString).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Australia/Adelaide',
      })
    } catch {
      return isoString
    }
  }

  const formatCurrency = (value: number) => `$${value.toLocaleString('en-AU')}`

  const statusBadgeColors = (status: string): { bg: string; fg: string } => {
    switch (status) {
      case 'active':
        return { bg: '#d1fae5', fg: '#065f46' }
      case 'trialing':
        return { bg: '#fdf3dc', fg: '#c8971f' }
      case 'trial_expired':
      case 'past_due':
      case 'canceled':
        return { bg: '#fee2e2', fg: '#991b1b' }
      case 'free':
        return { bg: '#e2e8f0', fg: '#475569' }
      default:
        return { bg: '#eef5f0', fg: '#1a3a2a' }
    }
  }

  const filteredSubscriptions = subscriptions.filter(s => {
    const matchEmail = !searchEmail || s.email.toLowerCase().includes(searchEmail.toLowerCase().trim())
    const matchPlan = filterPlan === 'all' || s.plan === filterPlan
    return matchEmail && matchPlan
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading subscription overview...</p>
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
        <p style={{ color: '#c53030', fontSize: 13, wordBreak: 'break-word', lineHeight: 1.6, marginBottom: 20 }}>
          {error}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={fetchSubscriptions}
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
        <p className="super-admin-kicker">Revenue</p>
        <h2>Subscriptions</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Read-only subscription and plan overview.
        </p>
      </section>

      {/* Read-only notice */}
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
        🔒 Read-only billing view. No payment actions are enabled.
      </div>

      {/* V1 data model notice */}
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

      {/* Summary Cards Row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>TOTAL ACCOUNTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{summary?.totalAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>TRIAL ACCOUNTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#c8971f' }}>{summary?.trialAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>ACTIVE PAID</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{summary?.activePaidAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>FREE / BASIC</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#475569' }}>{summary?.freeAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>SMS ADD-ON</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>{summary?.smsAddonAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>ESTIMATED MRR</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{formatCurrency(summary?.estimatedMrr ?? 0)}</h3>
        </div>
      </section>

      {/* Filter Toolbar */}
      <div className="super-admin-panel" style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: '#fcfcfc' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>SEARCH EMAIL</label>
          <input
            type="text"
            className="form-input"
            style={{ width: '100%', padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)' }}
            placeholder="Search owner email..."
            value={searchEmail}
            onChange={e => setSearchEmail(e.target.value)}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>PLAN</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
          >
            <option value="all">All Plans</option>
            <option value="trial">Trial</option>
            <option value="free">Free</option>
            <option value="basic">Basic ($5)</option>
            <option value="pro">Pro ($12)</option>
            <option value="kennel">Kennel ($29)</option>
          </select>
        </div>
      </div>

      {/* Subscriptions Table */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Account Subscriptions</h3>
          <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
            {filteredSubscriptions.length} Filtered
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {filteredSubscriptions.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No accounts match the active search filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Account / Organisation</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Owner Email</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Plan</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Subscription Status</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Trial Status / Ends</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>SMS Add-on</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Est. Monthly Value</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Last Sign In</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubscriptions.map(s => {
                  const statusColors = statusBadgeColors(s.subscriptionStatus)
                  return (
                    <tr key={s.uid} style={{ borderBottom: '1px solid #f4f6f5' }}>
                      <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{s.accountName}</td>
                      <td style={{ padding: '10px 8px', color: '#53635a' }}>{s.email}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: s.role === 'owner' ? '#e2e8f0' : '#e1f5ee',
                          color: s.role === 'owner' ? '#475569' : '#085041',
                          textTransform: 'uppercase',
                        }}>
                          {s.role}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          background: s.plan === 'trial' ? '#fdf3dc' : '#e1f5ee',
                          color: s.plan === 'trial' ? '#c8971f' : '#085041',
                          textTransform: 'uppercase',
                        }}>
                          {s.plan}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: statusColors.bg, color: statusColors.fg, textTransform: 'uppercase',
                        }}>
                          {s.subscriptionStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', color: '#53635a' }}>
                        {s.plan === 'trial'
                          ? `${s.trialStatus ?? 'unknown'}${s.trialEndsAt ? ` · ${formatDate(s.trialEndsAt)}` : ''}`
                          : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>{s.smsAddon ? '✓' : '—'}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#10291d' }}>
                        {formatCurrency(s.estimatedMonthlyValue)}
                      </td>
                      <td style={{ padding: '10px 8px', color: '#53635a' }}>{formatDate(s.registeredAt)}</td>
                      <td style={{ padding: '10px 8px', color: '#53635a' }}>{formatDate(s.lastSignInTime)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Link to={`/app/super-admin/users/${s.uid}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                            View User
                          </Link>
                          {s.role === 'breeder' && (
                            <Link to={`/app/super-admin/organisations/${s.uid}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                              View Org
                            </Link>
                          )}
                          <button
                            type="button"
                            disabled
                            title="Coming later"
                            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: '#f4f6f5', color: '#9aa39d', cursor: 'not-allowed' }}
                          >
                            Manage billing
                          </button>
                          <button
                            type="button"
                            disabled
                            title="Coming later"
                            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: '#f4f6f5', color: '#9aa39d', cursor: 'not-allowed' }}
                          >
                            Change plan
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
