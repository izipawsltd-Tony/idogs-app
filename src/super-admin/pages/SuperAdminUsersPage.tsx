import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface UserAccount {
  uid: string
  email: string
  role: string
  plan: string
  emailVerified: boolean
  createdAt: string | null
  lastSignInTime: string | null
  dogsCount: number
}

interface ApiResponse {
  users: UserAccount[]
}

export default function SuperAdminUsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  // Search & filter states
  const [searchEmail, setSearchEmail] = useState('')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterPlan, setFilterPlan] = useState<string>('all')

  async function fetchUsers() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/users', {
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
        throw new Error('The server returned a non-JSON response.')
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}))
        throw new Error(errorJson.message || `HTTP error ${res.status}`)
      }

      const json: ApiResponse = await res.json()
      setUsers(json.users || [])
    } catch (err: any) {
      console.error('Error fetching users data:', err)
      setError(err.message || 'Failed to connect to the users management API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
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

  // Calculate local aggregate metrics
  const totalUsers = users.length
  const breedersCount = users.filter(u => u.role === 'breeder').length
  const ownersCount = users.filter(u => u.role === 'owner').length
  const trialUsers = users.filter(u => u.plan === 'trial').length
  const proUsers = users.filter(u => u.plan === 'pro').length

  // Filter users based on state
  const filteredUsers = users.filter(u => {
    const matchEmail = !searchEmail || u.email.toLowerCase().includes(searchEmail.toLowerCase().trim())
    const matchRole = filterRole === 'all' || u.role === filterRole
    const matchPlan = filterPlan === 'all' || u.plan === filterPlan
    return matchEmail && matchRole && matchPlan
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading platform accounts...</p>
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
          onClick={fetchUsers}
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
        <h2>Users</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Platform account overview, verification state, and dog registries.
        </p>
      </section>

      {/* Database join info badge */}
      <div style={{
        padding: '12px 16px',
        background: '#eef5f0',
        border: '1px solid #dfe5df',
        borderRadius: 8,
        color: '#1a3a2a',
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: 24
      }}>
        ℹ️ <strong>System Note:</strong> The user listings below join Firestore metadata with live authentication profiles fetched from Firebase Auth to compute registration date, verification status, and login activity.
      </div>

      {/* Summary Cards Row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>TOTAL USERS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{totalUsers}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>BREEDERS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{breedersCount}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>PET OWNERS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#53635a' }}>{ownersCount}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>TRIALS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#c8971f' }}>{trialUsers}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>PAID PLANS</span>
          <h3 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{proUsers}</h3>
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
            placeholder="Search email address..."
            value={searchEmail}
            onChange={e => setSearchEmail(e.target.value)}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ROLE</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
          >
            <option value="all">All Roles</option>
            <option value="breeder">Breeders</option>
            <option value="owner">Pet Owners</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>PLAN</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
          >
            <option value="all">All Tiers</option>
            <option value="trial">Trial</option>
            <option value="basic">Basic ($5)</option>
            <option value="pro">Pro ($12)</option>
            <option value="kennel">Kennel ($29)</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Registered User Accounts</h3>
          <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
            {filteredUsers.length} Filtered
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {filteredUsers.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No users match the active search filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Email Address</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Plan Tier</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Email Verified</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'center' }}>Registered Dogs</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.uid} style={{ borderBottom: '1px solid #f4f6f5' }}>
                    <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{u.email}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: u.role === 'owner' ? '#e2e8f0' : '#e1f5ee',
                        color: u.role === 'owner' ? '#475569' : '#085041',
                        textTransform: 'uppercase'
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: u.plan === 'trial' ? '#fdf3dc' : '#e1f5ee',
                        color: u.plan === 'trial' ? '#c8971f' : '#085041',
                        textTransform: 'uppercase'
                      }}>
                        {u.plan}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: u.emailVerified ? '#d1fae5' : '#fee2e2',
                        color: u.emailVerified ? '#065f46' : '#991b1b'
                      }}>
                        {u.emailVerified ? 'Verified' : 'Unverified'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', color: '#53635a' }}>{formatDate(u.createdAt)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600, color: '#1a3a2a' }}>{u.dogsCount}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <Link to={`/app/super-admin/users/${u.uid}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', textDecoration: 'none' }}>
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
