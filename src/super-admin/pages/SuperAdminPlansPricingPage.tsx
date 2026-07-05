import { useState, useEffect, type CSSProperties } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface PlanRow {
  id: string
  name: string
  estimatedMonthlyPrice: number
  description: string
  accountsCount: number
  activePaidAccountsCount: number
  estimatedMrrContribution: number
  status: string
}

interface Summary {
  totalAccounts: number
  estimatedTotalMrr: number
  smsAddonAccounts: number
  smsAddonEstimatedMonthly: number
}

interface ApiResponse {
  plans: PlanRow[]
  summary: Summary
  dataModelNotice: string
}

export default function SuperAdminPlansPricingPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [dataModelNotice, setDataModelNotice] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchPlansPricing() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/plans-pricing', {
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
      setPlans(Array.isArray(json.plans) ? json.plans : [])
      setSummary(json.summary || null)
      setDataModelNotice(json.dataModelNotice || '')
    } catch (err: any) {
      console.error('Error fetching plans & pricing data:', err)
      setError(err.message || 'Failed to connect to the plans & pricing API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlansPricing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const formatCurrency = (value: number) => `$${value.toLocaleString('en-AU')}`

  const disabledButtonStyle: CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: '#f4f6f5',
    color: '#9aa39d',
    cursor: 'not-allowed',
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading plan catalogue...</p>
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
          onClick={fetchPlansPricing}
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
        <h2>Plans &amp; Pricing</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Read-only plan catalogue and usage overview.
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
        🔒 Pricing management is read-only in V1. Billing changes require a future approval workflow.
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
          ℹ️ <strong>Data model note:</strong> {dataModelNotice} This catalogue is a Super Admin-only display mirror of BillingPage.tsx pricing — not a shared runtime pricing source.
        </div>
      )}

      {/* Summary Cards Row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>TOTAL ACCOUNTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{summary?.totalAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>ESTIMATED TOTAL MRR</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{formatCurrency(summary?.estimatedTotalMrr ?? 0)}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>SMS ADD-ON ACCOUNTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>{summary?.smsAddonAccounts ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>SMS ADD-ON EST. MONTHLY</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{formatCurrency(summary?.smsAddonEstimatedMonthly ?? 0)}</h3>
        </div>
      </section>

      {/* Plan Catalogue Cards */}
      <section className="super-admin-module-grid" style={{ marginBottom: 24 }}>
        {plans.map(plan => (
          <div key={plan.id} className="super-admin-module-card">
            <span>{plan.status.toUpperCase()}</span>
            <h3>{plan.name}</h3>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#085041', margin: '2px 0 8px' }}>
              {plan.estimatedMonthlyPrice === 0 ? 'Free' : `${formatCurrency(plan.estimatedMonthlyPrice)}/mo`}
            </p>
            <p>{plan.description}</p>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e6ece7', fontSize: 12, color: '#53635a', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Accounts on plan: <strong style={{ color: '#10291d' }}>{plan.accountsCount}</strong></span>
              <span>Estimated MRR contribution: <strong style={{ color: '#10291d' }}>{formatCurrency(plan.estimatedMrrContribution)}</strong></span>
            </div>
          </div>
        ))}
      </section>

      {/* Plan Usage Table */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Plan Usage &amp; Estimated MRR</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Plan</th>
                <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Est. Monthly Price</th>
                <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Accounts</th>
                <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Active Paid Accounts</th>
                <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Estimated MRR</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr key={plan.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                  <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{plan.name}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{formatCurrency(plan.estimatedMonthlyPrice)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600 }}>{plan.accountsCount}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>{plan.activePaidAccountsCount}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#085041' }}>{formatCurrency(plan.estimatedMrrContribution)}</td>
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#eef5f0', color: '#1a3a2a', textTransform: 'uppercase' }}>
                      {plan.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Future action buttons — disabled */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Billing Operations</h3>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Edit pricing — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Connect Stripe — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Sync billing — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Create coupon — Coming later</button>
        </div>
      </div>
    </div>
  )
}
