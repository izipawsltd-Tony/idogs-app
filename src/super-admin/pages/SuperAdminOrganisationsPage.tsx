import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface Organisation {
  id: string
  name: string
  email: string
  plan: string
  status: string
  createdAt: string | null
  dogsCount: number
  littersCount: number
  puppiesCount: number
  lastActivity: string | null
}

interface ApiResponse {
  organisations: Organisation[]
}

export default function SuperAdminOrganisationsPage() {
  const { user } = useAuth()
  const [organisations, setOrganisations] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchOrganisations() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/organisations', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true)
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('The server returned a non-JSON response. If running locally, please ensure you are using "vercel dev" instead of "npm run dev".')
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}))
        throw new Error(errorJson.message || `HTTP error ${res.status}`)
      }

      const json: ApiResponse = await res.json()
      setOrganisations(json.organisations || [])
    } catch (err: any) {
      console.error('Error fetching organisations:', err)
      setError(err.message || 'Failed to fetch organisations data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrganisations()
  }, [user])

  const formatDate = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Australia/Adelaide'
      })
    } catch {
      return isoString
    }
  }

  const formatTimeAgo = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      const diffMs = new Date().getTime() - new Date(isoString).getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return `${diffDays}d ago`
    } catch {
      return '—'
    }
  }

  // Calculate local aggregates
  const totalOrgs = organisations.length
  const trialOrgs = organisations.filter(o => o.plan === 'trial').length
  const proOrgs = organisations.filter(o => o.plan === 'pro').length
  
  // Estimate MRR from list
  const PLAN_PRICES: Record<string, number> = { basic: 5, pro: 12, kennel: 29 }
  const estimatedMrr = organisations.reduce((sum, o) => {
    if (o.status.toLowerCase() === 'active') {
      const price = PLAN_PRICES[o.plan.toLowerCase()] || 0
      return sum + price
    }
    return sum;
  }, 0)

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
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading breeder organisations...</p>
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

  if (error) {
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
        <div style={{ fontSize: 48, marginBottom: 16 }}> </div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Connection Error</h3>
        <p style={{ color: '#c53030', fontSize: 13, wordBreak: 'break-word', lineHeight: 1.6, marginBottom: 20 }}>
          {error}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={fetchOrganisations}
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
        <p className="super-admin-kicker">Management</p>
        <h2>Organisations</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Breeder tenant overview and kennel records.
        </p>
      </section>

      {/* Model Disclaimer */}
      <div style={{
        padding: '12px 16px',
        background: '#fdf3dc',
        border: '1px solid #f5d6a8',
        borderRadius: 8,
        color: '#8f6804',
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 24
      }}>
        ⚠️ <strong>iDogs V1 tenant model note:</strong> iDogs V1 currently treats each breeder account as one organisation/tenant until formal multi-user organisation structures are introduced.
      </div>

      {/* Summary Cards Grid */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>TOTAL ORGANISATIONS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{totalOrgs}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>TRIAL TENANTS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#c8971f' }}>{trialOrgs}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>PRO PLANS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{proOrgs}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>ESTIMATED MRR</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>${estimatedMrr} <span style={{ fontSize: 13, fontWeight: 'normal', color: '#6c7a70' }}>AUD</span></h3>
        </div>
      </section>

      {/* Organisations List Table */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Registered Breeder Tenants</h3>
          <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
            {organisations.length} Total
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {organisations.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No breeder accounts found.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Organisation / Kennel</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Owner Email</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Plan</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Dogs</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Litters</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Puppies</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Last Activity</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organisations.map(org => (
                  <tr key={org.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                    <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{org.name}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{org.email}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: org.plan === 'trial' ? '#fdf3dc' : '#e1f5ee',
                        color: org.plan === 'trial' ? '#c8971f' : '#085041',
                        textTransform: 'uppercase'
                      }}>
                        {org.plan}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', textTransform: 'capitalize', color: '#53635a' }}>{org.status}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{formatDate(org.createdAt)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 500 }}>{org.dogsCount}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 500 }}>{org.littersCount}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 500 }}>{org.puppiesCount}</td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }} title={org.lastActivity || ''}>{formatTimeAgo(org.lastActivity)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <Link to={`/app/super-admin/organisations/${org.id}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
                        View Detail
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
