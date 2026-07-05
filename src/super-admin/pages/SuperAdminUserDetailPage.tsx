import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface AssociatedDog {
  id: string
  name: string
  breed: string
  sex: string
  dateOfBirth: string
  lifeStage: string
  isDeceased: boolean
  status: string
  association: string // 'Breeder' | 'Owner'
}

interface AssociatedLitter {
  id: string
  name: string
  actualBirthDate: string | null
  puppiesCount: number
}

interface AuditLog {
  id: string
  action: string
  details: string
  performedByEmail: string
  createdAt: string
}

interface UserDetail {
  uid: string
  email: string
  role: string
  plan: string
  emailVerified: boolean
  createdAt: string | null
  lastSignInTime: string | null
  firstName: string | null
  lastName: string | null
  kennelName: string | null
  state: string | null
  phone: string | null
  subscriptionStatus: string | null
  stripeSubscriptionId: string | null
  dogsCount: number
  littersCount: number
  puppiesCount: number
  dogs: AssociatedDog[]
  litters: AssociatedLitter[]
  recentActivity: AuditLog[]
}

interface ApiResponse {
  user: UserDetail
}

export default function SuperAdminUserDetailPage() {
  const { uid } = useParams<{ uid: string }>()
  const { user } = useAuth()
  const [data, setData] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchUserDetail() {
    if (!user || !uid) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/super-admin/users/${uid}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true)
        return
      }

      if (res.status === 404) {
        throw new Error('User account not found on this platform.')
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
      setData(json.user)
    } catch (err: any) {
      console.error('Error fetching user detail:', err)
      setError(err.message || 'Failed to fetch details.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUserDetail()
  }, [user, uid])

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

  const getDogAge = (dob: string) => {
    if (!dob) return '—'
    try {
      const birth = new Date(dob)
      const diffMs = new Date().getTime() - birth.getTime()
      const diffYears = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000))
      const diffMonths = Math.floor((diffMs % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000))

      if (diffYears === 0) return `${diffMonths}mo`
      if (diffMonths === 0) return `${diffYears}yr`
      return `${diffYears}yr ${diffMonths}mo`
    } catch {
      return '—'
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading user account details...</p>
      </div>
    )
  }

  if (unauthorized) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: '#ffffff', border: '1px solid #dfe5df', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(16,41,29,0.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Access Denied</h3>
        <p style={{ color: '#53635a', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          Access restricted to operators only.
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: '#ffffff', border: '1px solid #dfe5df', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(16,41,29,0.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Record Error</h3>
        <p style={{ color: '#c53030', fontSize: 13, wordBreak: 'break-word', lineHeight: 1.6, marginBottom: 20 }}>
          {error || 'Failed to fetch details.'}
        </p>
        <Link to="/app/super-admin/users" className="btn btn-secondary">
          Return to List
        </Link>
      </div>
    )
  }

  const isBreeder = data.role === 'breeder'

  return (
    <div className="super-admin-page">
      <div style={{ marginBottom: 16 }}>
        <Link to="/app/super-admin/users" style={{ fontSize: 13, color: '#53635a', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Users
        </Link>
      </div>

      {/* Title section */}
      <section className="super-admin-page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <p className="super-admin-kicker">Platform User Profile</p>
          <h2>{data.email}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
            Full Name: <strong>{data.firstName || '—'} {data.lastName || ''}</strong> | Registered: <strong>{formatDate(data.createdAt)}</strong> | UID: <code style={{ fontSize: 11, background: '#eef5f0', padding: '2px 4px', borderRadius: 4 }}>{data.uid}</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: 6,
            background: data.role === 'owner' ? '#e2e8f0' : '#e1f5ee',
            color: data.role === 'owner' ? '#475569' : '#085041',
            textTransform: 'uppercase'
          }}>
            Role: {data.role}
          </span>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: 6,
            background: data.emailVerified ? '#d1fae5' : '#fee2e2',
            color: data.emailVerified ? '#065f46' : '#991b1b'
          }}>
            {data.emailVerified ? 'Email Verified' : 'Email Unverified'}
          </span>
        </div>
      </section>

      {/* Warning limitation block */}
      <div className="super-admin-panel" style={{ background: '#fbfcfc', border: '1px solid #dfe5df', padding: 16, marginBottom: 24, borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#53635a', fontWeight: 700, textTransform: 'uppercase' }}>Operational Limitations Warning</h4>
        <p style={{ margin: 0, fontSize: 12, color: '#6c7a70', lineHeight: 1.5 }}>
          This console provides a <strong>read-only</strong> inspection tool. User credentials modification, email verification toggling, password resetting, and account deletion are completely disabled in iDogs V1.
        </p>
      </div>

      {/* Metrics Row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>ACTIVE REGISTERED DOGS</span>
          <h3 style={{ fontSize: 24, margin: '4px 0 0', fontWeight: 700, color: '#10291d' }}>{data.dogsCount}</h3>
        </div>
        {isBreeder && (
          <>
            <div className="super-admin-module-card">
              <span>LITTERS REGISTERED</span>
              <h3 style={{ fontSize: 24, margin: '4px 0 0', fontWeight: 700, color: '#10291d' }}>{data.littersCount}</h3>
            </div>
            <div className="super-admin-module-card">
              <span>PUPPIES PRODUCED</span>
              <h3 style={{ fontSize: 24, margin: '4px 0 0', fontWeight: 700, color: '#10291d' }}>{data.puppiesCount}</h3>
            </div>
          </>
        )}
        <div className="super-admin-module-card">
          <span>LAST SIGN IN</span>
          <h3 style={{ fontSize: 15, margin: '14px 0 0', fontWeight: 600, color: '#53635a' }}>
            {data.lastSignInTime ? formatDateTime(data.lastSignInTime) : 'Never logged in'}
          </h3>
        </div>
      </section>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
        
        {/* Left column: Dogs and Litters lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Associated Dogs */}
          <div className="super-admin-panel" style={{ padding: 20 }}>
            <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Associated Dogs</h3>
              <span className="super-admin-status" style={{ background: '#eef5f0', color: '#1a3a2a' }}>{data.dogs.length} Total</span>
            </div>

            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {data.dogs.length === 0 ? (
                <p style={{ fontSize: 13, color: '#6c7a70', padding: '16px 0', textAlign: 'center' }}>No associated dogs.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Breed</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Sex</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Age</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Role Link</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dogs.map(dog => (
                      <tr key={dog.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                        <td style={{ padding: '6px 4px', color: '#10291d', fontWeight: 600 }}>{dog.name}</td>
                        <td style={{ padding: '6px 4px', color: '#53635a' }}>{dog.breed}</td>
                        <td style={{ padding: '6px 4px', textTransform: 'capitalize', color: '#53635a' }}>{dog.sex}</td>
                        <td style={{ padding: '6px 4px', color: '#53635a' }}>{getDogAge(dog.dateOfBirth)}</td>
                        <td style={{ padding: '6px 4px', color: '#53635a' }}>{dog.association}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: dog.isDeceased ? '#fee2e2' : dog.status === 'transferred' ? '#e2e8f0' : '#e1f5ee',
                            color: dog.isDeceased ? '#991b1b' : dog.status === 'transferred' ? '#475569' : '#085041'
                          }}>
                            {dog.isDeceased ? 'Deceased' : dog.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Associated Litters (Breeders only) */}
          {isBreeder && (
            <div className="super-admin-panel" style={{ padding: 20 }}>
              <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Litters Produced</h3>
                <span className="super-admin-status" style={{ background: '#eef5f0', color: '#1a3a2a' }}>{data.litters.length} Total</span>
              </div>

              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {data.litters.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#6c7a70', padding: '16px 0', textAlign: 'center' }}>No litters registered.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                        <th style={{ padding: '6px 4px', fontWeight: 600 }}>Litter Reference</th>
                        <th style={{ padding: '6px 4px', fontWeight: 600 }}>Birth / Due Date</th>
                        <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Puppies Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.litters.map(litter => (
                        <tr key={litter.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                          <td style={{ padding: '6px 4px', color: '#10291d', fontWeight: 600 }}>{litter.name}</td>
                          <td style={{ padding: '6px 4px', color: '#53635a' }}>{formatDate(litter.actualBirthDate)}</td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600, color: '#1a3a2a' }}>{litter.puppiesCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right column: Audit log actions and operation toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Audit Logs */}
          <div className="super-admin-panel" style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="super-admin-panel-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>User Activity Trail</h3>
              <span className="super-admin-status" style={{ background: '#eef5f0', color: '#1a3a2a' }}>Audit History</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 360 }}>
              {data.recentActivity.length === 0 ? (
                <p style={{ fontSize: 13, color: '#6c7a70', padding: '20px 0', textAlign: 'center' }}>No security logs associated with this user account.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Timestamp</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Action</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentActivity.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f4f6f5' }}>
                        <td style={{ padding: '6px 4px', color: '#53635a', whiteSpace: 'nowrap' }}>{formatDateTime(log.createdAt)}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 600 }}>
                          <span style={{ fontSize: 10, background: '#e9ece9', padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' }}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '6px 4px', color: '#53635a' }}>{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Placeholder operations */}
          <div className="super-admin-panel" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: '#10291d' }}>Console Operations</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                Impersonate User (Coming later)
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                Toggle Email Verification (Coming later)
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                Reset Password (Coming later)
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.5, cursor: 'not-allowed', color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' }}>
                Delete User Account (Coming later)
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
