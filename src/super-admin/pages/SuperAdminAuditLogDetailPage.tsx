import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface AuditLogDetail {
  id: string
  createdAt: string | null
  action: string
  details: string
  tenantId: string | null
  dogId: string | null
  dogName: string | null
  performedBy: string | null
  performedByEmail: string | null
  actorRole: string | null
  tenantIsOrganisation: boolean
}

interface ApiResponse {
  auditLog: AuditLogDetail
  dataModelNotice: string
}

export default function SuperAdminAuditLogDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [data, setData] = useState<AuditLogDetail | null>(null)
  const [dataModelNotice, setDataModelNotice] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [notFound, setNotFound] = useState(false)

  async function fetchDetail() {
    if (!user || !id) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    setNotFound(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/super-admin/audit-logs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true)
        return
      }

      if (res.status === 404) {
        setNotFound(true)
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
      setData(json.auditLog || null)
      setDataModelNotice(json.dataModelNotice || '')
    } catch (err: any) {
      console.error('Error fetching audit log detail:', err)
      setError(err.message || 'Failed to connect to the audit logs API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id])

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
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading audit log event...</p>
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

  if (notFound) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: '#ffffff', border: '1px solid #dfe5df', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(16,41,29,0.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
        <h3 style={{ fontSize: 20, color: '#1a3a2a', marginBottom: 8, fontWeight: 700 }}>Event Not Found</h3>
        <p style={{ color: '#53635a', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          This audit log event does not exist or has been removed from the collection.
        </p>
        <Link to="/app/super-admin/audit-logs" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>Back to Audit Logs</Link>
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
          onClick={fetchDetail}
          style={{ background: '#10291d', borderColor: '#10291d', color: '#fff', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Retry Connection
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ marginBottom: 20 }}>
        <p className="super-admin-kicker">Operations · Audit Logs</p>
        <h2>Event Detail</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>Read-only view of a single audit log event.</p>
      </section>

      <div style={{
        padding: '12px 16px',
        background: '#fdf3dc',
        border: '1px solid #f0e2b8',
        borderRadius: 8,
        color: '#7a5b0c',
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: 20,
        fontWeight: 600,
      }}>
        🔒 Read-only. No mutation actions are enabled for audit log events.
      </div>

      <div className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Event Fields</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, fontSize: 13 }}>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>EVENT ID</span>{data.id}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>TIMESTAMP</span>{formatDateTime(data.createdAt)}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ACTION</span>{data.action}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ACTOR</span>{data.performedByEmail || data.performedBy || 'System'}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ACTOR ROLE</span>{data.actorRole || '—'}</div>
          <div><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>TARGET</span>{data.dogName || data.dogId || '—'}</div>
        </div>

        <div style={{ marginTop: 20 }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 6 }}>DETAILS</span>
          <p style={{ fontSize: 13, color: '#1a3a2a', background: '#f7f9f8', border: '1px solid #e6ece7', borderRadius: 6, padding: 12, whiteSpace: 'pre-wrap' }}>
            {data.details || '—'}
          </p>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {data.performedBy && (
            <Link to={`/app/super-admin/users/${data.performedBy}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              View Actor User
            </Link>
          )}
          {data.tenantId && data.tenantIsOrganisation && (
            <Link to={`/app/super-admin/organisations/${data.tenantId}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              View Organisation
            </Link>
          )}
          <Link to="/app/super-admin/audit-logs" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
            Back to Audit Logs
          </Link>
        </div>
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
        }}>
          ℹ️ <strong>Data model note:</strong> {dataModelNotice}
        </div>
      )}
    </div>
  )
}
