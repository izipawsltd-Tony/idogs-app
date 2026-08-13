import { useState, useEffect, type CSSProperties } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface Environment {
  appMode: string
  firebaseProjectId: string | null
  apiRoutingStatus: string
  deploymentTarget: string
  productionStatus: string
  lastCheckedAt: string
}

interface SuperAdminAccess {
  allowlistedEmails: string[]
  emailVerificationRequired: boolean
  serverSideAllowlistEnforced: boolean
  frontendGatePresent: boolean
  warning: string
}

interface GuardrailItem {
  label: string
  met: boolean
}

interface ModuleStatusItem {
  name: string
  status: string
}

interface IntegrationItem {
  name: string
  status: string
}

interface Settings {
  environment: Environment
  superAdminAccess: SuperAdminAccess
  securityGuardrails: GuardrailItem[]
  moduleStatus: ModuleStatusItem[]
  integrations: IntegrationItem[]
  deploymentChecklist: string[]
  notices: string[]
}

interface ApiResponse {
  settings: Settings
}

const disabledButtonStyle: CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: '#f4f6f5',
  color: '#9aa39d',
  cursor: 'not-allowed',
}

function statusBadge(status: string) {
  const isActive = status.toLowerCase().includes('active') || status.toLowerCase() === 'configured'
  const isDisabled = status.toLowerCase().includes('disabled') || status.toLowerCase().includes('not connected') || status.toLowerCase().includes('placeholder')
  const bg = isActive ? '#d1fae5' : isDisabled ? '#f4f6f5' : '#fdf3dc'
  const fg = isActive ? '#065f46' : isDisabled ? '#6c7a70' : '#7a5b0c'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color: fg, textTransform: 'uppercase' }}>
      {status}
    </span>
  )
}

export default function SuperAdminSettingsPage() {
  const { user } = useAuth()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  async function fetchSettings() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/settings', {
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
      setSettings(json.settings || null)
    } catch (err: any) {
      console.error('Error fetching platform settings:', err)
      setError(err.message || 'Failed to connect to the settings API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
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

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading platform settings...</p>
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
          onClick={fetchSettings}
          style={{ background: '#10291d', borderColor: '#10291d', color: '#fff', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Retry Connection
        </button>
      </div>
    )
  }

  if (!settings) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, textAlign: 'center', color: '#53635a', fontSize: 13 }}>
        No settings data was returned by the server.
      </div>
    )
  }

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ marginBottom: 20 }}>
        <p className="super-admin-kicker">System</p>
        <h2>Platform Settings</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Read-only platform configuration and safety overview.
        </p>
      </section>

      {settings.notices.map((notice, i) => (
        <div key={i} style={{
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
          🔒 {notice}
        </div>
      ))}

      {/* A. Environment & Deployment Safety */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20, marginTop: 12 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Environment &amp; Deployment Safety</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, fontSize: 13 }}>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>APP MODE</span>{settings.environment.appMode}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>FIREBASE PROJECT ID</span>{settings.environment.firebaseProjectId || 'Not available'}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>API ROUTING</span>{settings.environment.apiRoutingStatus}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>DEPLOYMENT TARGET</span>{settings.environment.deploymentTarget}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>PRODUCTION STATUS</span>{settings.environment.productionStatus}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>LAST CHECKED</span>{formatDateTime(settings.environment.lastCheckedAt)}</div>
        </div>
      </div>

      {/* B. Super Admin Access */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Super Admin Access</h3>
        </div>
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 6 }}>ALLOWLISTED EMAILS</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {settings.superAdminAccess.allowlistedEmails.map(email => (
              <span key={email} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#eef5f0', color: '#1a3a2a' }}>
                {email}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13, marginBottom: 14 }}>
          <div>Email verification required: <strong>{settings.superAdminAccess.emailVerificationRequired ? 'Yes' : 'No'}</strong></div>
          <div>Server-side allowlist enforced: <strong>{settings.superAdminAccess.serverSideAllowlistEnforced ? 'Yes' : 'No'}</strong></div>
          <div>Frontend gate present: <strong>{settings.superAdminAccess.frontendGatePresent ? 'Yes' : 'No'}</strong></div>
        </div>
        <div style={{
          padding: '10px 14px', background: '#fdf3dc', border: '1px solid #f0e2b8', borderRadius: 8,
          color: '#7a5b0c', fontSize: 12, fontWeight: 600, marginBottom: 14,
        }}>
          ⚠️ {settings.superAdminAccess.warning}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Add admin — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Remove admin — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Manage roles — Coming later</button>
        </div>
      </div>

      {/* C. Security Guardrails */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Security Guardrails</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {settings.securityGuardrails.map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1a3a2a' }}>
              <span style={{ color: g.met ? '#065f46' : '#991b1b', fontWeight: 700 }}>{g.met ? '✓' : '✗'}</span>
              {g.label}
            </div>
          ))}
        </div>
      </div>

      {/* D. Module Status */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Module Status</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Module</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {settings.moduleStatus.map(m => (
                <tr key={m.name} style={{ borderBottom: '1px solid #f4f6f5' }}>
                  <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{m.name}</td>
                  <td style={{ padding: '10px 8px' }}>{statusBadge(m.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* E. Integration Status */}
      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Integration Status</h3>
        </div>
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Integration</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {settings.integrations.map(i => (
                <tr key={i.name} style={{ borderBottom: '1px solid #f4f6f5' }}>
                  <td style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{i.name}</td>
                  <td style={{ padding: '10px 8px' }}>{statusBadge(i.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Connect Stripe — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Configure Email — Coming later</button>
          <button type="button" disabled title="Coming later" style={disabledButtonStyle}>Connect Support Tool — Coming later</button>
          <button type="button" disabled title="Restricted" style={disabledButtonStyle}>Rotate Keys — Restricted</button>
          <button type="button" disabled title="Restricted" style={disabledButtonStyle}>Edit Environment — Restricted</button>
        </div>
      </div>

      {/* F. Operational Safety Checklist */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Operational Safety Checklist</h3>
          <span style={{ fontSize: 11, color: '#6c7a70' }}>For Tony to confirm manually before push/deploy</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {settings.deploymentChecklist.map((item, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1a3a2a' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--border)', display: 'inline-block', flexShrink: 0 }} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
