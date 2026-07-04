import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface DashboardData {
  generatedAt: string
  metrics: {
    totalOrganisations: number
    totalUsers: number
    breakdown: {
      breeders: number
      owners: number
    }
    activeSubscriptions: number
    mrr: number
    trials: number
    churnRate: number | null
  }
  recentSignups: Array<{
    uid: string
    email: string
    role: string
    plan: string
    createdAt: string
  }>
  recentActivity: Array<{
    id: string
    action: string
    details: string
    performedByEmail: string
    createdAt: string
  }>
  systemStatus: {
    apiStatus: string
    authStatus: string
    dataQueryStatus: string
  }
  limitations: {
    mrr: string
    churnRate: string
    systemStatus: string
    authTesting: string
  }
}

export default function SuperAdminOverviewPage() {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchDashboardData() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/dashboard', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true)
        return
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}))
        throw new Error(errorJson.message || `HTTP error ${res.status}`)
      }

      const json = await res.json()
      setData(json)
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err)
      setError(err.message || 'Failed to connect to the Super Admin API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [user])

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleString('en-AU', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Australia/Adelaide'
      })
    } catch {
      return isoString
    }
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px',
        color: '#1a3a2a'
      }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Retrieving operational metrics...</p>
      </div>
    )
  }

  if (unauthorized) {
    return (
      <div style={{
        maxWidth: 500,
        margin: '60px auto',
        padding: 32,
        background: '#ffffff',
        border: '1px solid #dfe5df',
        borderRadius: 12,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(16,41,29,0.06)'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Access Denied</h3>
        <p style={{ color: '#53635a', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          Your account does not possess Super Admin permissions. This console is restricted to authorized platform operators only.
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{
        maxWidth: 500,
        margin: '60px auto',
        padding: 32,
        background: '#ffffff',
        border: '1px solid #dfe5df',
        borderRadius: 12,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(16,41,29,0.06)'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Connection Error</h3>
        <p style={{ color: '#c53030', fontSize: 13, wordBreak: 'break-word', lineHeight: 1.6, marginBottom: 20 }}>
          {error || 'The system could not fetch the dashboard data.'}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={fetchDashboardData}
          style={{ background: '#10291d', borderColor: '#10291d', color: '#fff', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Retry Connection
        </button>
      </div>
    )
  }

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <p className="super-admin-kicker">Console</p>
          <h2>Operational Dashboard</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
            Real-time platform KPIs, subscriptions, and security logs.
          </p>
        </div>
        <div style={{ fontSize: 11, color: '#6c7a70', background: '#eef5f0', padding: '6px 12px', borderRadius: 6, fontWeight: 600 }}>
          Refreshed: {formatDateTime(data.generatedAt)}
        </div>
      </section>

      {/* KPI Cards Row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        
        {/* Total Organisations */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div>
            <span>ORGANISATIONS</span>
            <h3 style={{ fontSize: 28, margin: '6px 0 2px', fontWeight: 700, color: '#10291d' }}>
              {data.metrics.totalOrganisations}
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#6c7a70', margin: 0 }}>
            One breeder user = one tenant
          </p>
        </div>

        {/* Total Users */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div>
            <span>TOTAL USERS</span>
            <h3 style={{ fontSize: 28, margin: '6px 0 2px', fontWeight: 700, color: '#10291d' }}>
              {data.metrics.totalUsers}
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#6c7a70', margin: 0 }}>
            Breeders: {data.metrics.breakdown.breeders} | Owners: {data.metrics.breakdown.owners}
          </p>
        </div>

        {/* Active Subscriptions */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div>
            <span>PAID SUBSCRIPTIONS</span>
            <h3 style={{ fontSize: 28, margin: '6px 0 2px', fontWeight: 700, color: '#10291d' }}>
              {data.metrics.activeSubscriptions}
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#6c7a70', margin: 0 }}>
            Stripe Status: active
          </p>
        </div>

        {/* MRR */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div>
            <span>ESTIMATED MRR</span>
            <h3 style={{ fontSize: 28, margin: '6px 0 2px', fontWeight: 700, color: '#1a3a2a' }}>
              ${data.metrics.mrr} <span style={{ fontSize: 14, fontWeight: 'normal', color: '#6c7a70' }}>AUD</span>
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#6c7a70', margin: 0 }}>
            Active plans + SMS add-on
          </p>
        </div>

        {/* Trials */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div>
            <span>ACTIVE TRIALS</span>
            <h3 style={{ fontSize: 28, margin: '6px 0 2px', fontWeight: 700, color: '#c8971f' }}>
              {data.metrics.trials}
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#6c7a70', margin: 0 }}>
            Breeder trial period active
          </p>
        </div>

        {/* Churn Rate */}
        <div className="super-admin-module-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110, background: '#fcfcfc' }}>
          <div>
            <span style={{ color: '#8c9890' }}>CHURN RATE</span>
            <h3 style={{ fontSize: 20, margin: '14px 0 2px', fontWeight: 600, color: '#8c9890' }}>
              Not available
            </h3>
          </div>
          <p style={{ fontSize: 11, color: '#8c9890', margin: 0 }}>
            Requires cohort log history
          </p>
        </div>

      </section>

      {/* Main Content Layout Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 20, marginBottom: 24 }}>
        
        {/* Recent Activity Card */}
        <div className="super-admin-panel" style={{ margin: 0, padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
            <div>
              <p className="super-admin-kicker">Security logs</p>
              <h3 style={{ margin: 0 }}>Recent Platform Activity</h3>
            </div>
            <span className="super-admin-status" style={{ background: '#eef5f0', color: '#1a3a2a' }}>Live Feed</span>
          </div>
          
          <div style={{ flex: 1, overflowX: 'auto' }}>
            {data.recentActivity.length === 0 ? (
              <p style={{ fontSize: 13, color: '#6c7a70', padding: '20px 0', textAlign: 'center' }}>No recent logs recorded.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                    <th style={{ padding: '8px 4px', fontWeight: 600 }}>Timestamp</th>
                    <th style={{ padding: '8px 4px', fontWeight: 600 }}>Actor</th>
                    <th style={{ padding: '8px 4px', fontWeight: 600 }}>Action</th>
                    <th style={{ padding: '8px 4px', fontWeight: 600 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentActivity.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                      <td style={{ padding: '8px 4px', color: '#53635a', whiteSpace: 'nowrap' }}>{formatDateTime(log.createdAt)}</td>
                      <td style={{ padding: '8px 4px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#10291d' }} title={log.performedByEmail}>
                        {log.performedByEmail}
                      </td>
                      <td style={{ padding: '8px 4px', fontWeight: 600 }}>
                        <span style={{ fontSize: 11, background: '#e9ece9', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '8px 4px', color: '#53635a' }}>{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Signups Card */}
        <div className="super-admin-panel" style={{ margin: 0, padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
            <div>
              <p className="super-admin-kicker">Accounts</p>
              <h3 style={{ margin: 0 }}>Recent User Signups</h3>
            </div>
            <span className="super-admin-status" style={{ background: '#eef5f0', color: '#1a3a2a' }}>Latest Users</span>
          </div>

          <div style={{ flex: 1, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '8px 4px', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '8px 4px', fontWeight: 600 }}>Email Address</th>
                  <th style={{ padding: '8px 4px', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '8px 4px', fontWeight: 600 }}>Plan Tier</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSignups.map(signup => (
                  <tr key={signup.uid} style={{ borderBottom: '1px solid #f4f6f5' }}>
                    <td style={{ padding: '8px 4px', color: '#53635a', whiteSpace: 'nowrap' }}>{formatDateTime(signup.createdAt)}</td>
                    <td style={{ padding: '8px 4px', color: '#10291d', fontWeight: 500 }}>{signup.email}</td>
                    <td style={{ padding: '8px 4px', textTransform: 'capitalize', color: '#53635a' }}>{signup.role}</td>
                    <td style={{ padding: '8px 4px' }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: signup.plan === 'trial' ? '#fdf3dc' : '#e1f5ee',
                        color: signup.plan === 'trial' ? '#c8971f' : '#085041'
                      }}>
                        {signup.plan.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* System Status & Warnings Section */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        
        {/* Dashboard Request Verification */}
        <div className="super-admin-panel" style={{ margin: 0, padding: 20 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#10291d' }}>Dashboard Request Verification</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span>Dashboard API Reachable</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#085041', background: '#e1f5ee', padding: '2px 8px', borderRadius: 4 }}>
                {data.systemStatus.apiStatus.toUpperCase()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span>Admin Authorisation Verified</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#085041', background: '#e1f5ee', padding: '2px 8px', borderRadius: 4 }}>
                {data.systemStatus.authStatus.toUpperCase()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span>Dashboard Data Query Completed</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#085041', background: '#e1f5ee', padding: '2px 8px', borderRadius: 4 }}>
                {data.systemStatus.dataQueryStatus.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Console Explanations and Disclaimers */}
        <div className="super-admin-panel" style={{ margin: 0, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#6c7a70' }}>DATA COLLECTION DISCLAIMERS</h4>
          <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, lineHeight: 1.5, color: '#6c7a70' }}>
            <li style={{ marginBottom: 4 }}><strong>MRR Scope</strong>: {data.limitations.mrr}</li>
            <li style={{ marginBottom: 4 }}><strong>Churn Scope</strong>: {data.limitations.churnRate}</li>
            <li style={{ marginBottom: 4 }}><strong>Status Scope</strong>: {data.limitations.systemStatus}</li>
            <li><strong>Auth Testing Note</strong>: {data.limitations.authTesting}</li>
          </ul>
        </div>

      </section>
    </div>
  )
}
