import { Fragment, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface AuditLogRow {
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
  isDeletionEvent: boolean
  targetUserId: string | null
  targetUserEmail: string | null
  targetOrganisationId: string | null
  targetOrganisationName: string | null
  reason: string | null
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
}

interface Summary {
  totalRecentEvents: number
  eventsLast24h: number
  uniqueActors: number
  uniqueTenants: number
  deletionEvents: number
}

interface ApiResponse {
  auditLogs: AuditLogRow[]
  summary: Summary
  dataModelNotice: string
}

const ACTION_LABELS: Record<string, string> = {
  dog_created: 'Dog added',
  dog_updated: 'Dog updated',
  dog_deleted: 'Dog deleted',
  dog_transferred: 'Ownership transferred',
  vaccine_added: 'Vaccine added',
  vaccine_deleted: 'Vaccine deleted',
  health_test_added: 'Health test added',
  health_test_deleted: 'Health test deleted',
  worming_added: 'Worming added',
  worming_deleted: 'Worming deleted',
  document_uploaded: 'Document uploaded',
  reminder_completed: 'Reminder completed',
  litter_created: 'Litter created',
  puppy_added: 'Puppy added',
  life_stage_changed: 'Life stage changed',
  super_admin_suspend_account: 'Suspend account',
  super_admin_reactivate_account: 'Reactivate account',
  super_admin_grant_entitlement: 'Grant entitlement',
  super_admin_update_entitlement: 'Update entitlement',
  super_admin_revoke_entitlement: 'Revoke entitlement',
}

export function auditStateSummary(state: Record<string, unknown> | null): string {
  if (!state) return 'Not recorded'
  const account = state.account as { access?: string } | undefined
  const entitlement = state.entitlement as { granted?: boolean; expiresAt?: string | null } | null | undefined
  const parts: string[] = []
  if (account?.access) parts.push(`Access: ${account.access}`)
  if (entitlement) parts.push(`Entitlement: ${entitlement.granted ? `granted${entitlement.expiresAt ? ` until ${entitlement.expiresAt}` : ''}` : 'revoked'}`)
  return parts.length ? parts.join('; ') : 'Recorded state'
}

function auditStateDetails(state: Record<string, unknown> | null): string {
  return state ? JSON.stringify(state, null, 2) : 'Not recorded'
}

type DateFilter = 'all' | '24h' | '7d' | '30d'

export default function SuperAdminAuditLogsPage() {
  const { user } = useAuth()
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [dataModelNotice, setDataModelNotice] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('all')
  const [filterRole, setFilterRole] = useState('all')
  const [filterDate, setFilterDate] = useState<DateFilter>('all')
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [technicalLogId, setTechnicalLogId] = useState<string | null>(null)

  function toggleLogDetails(logId: string) {
    setExpandedLogId(expandedLogId === logId ? null : logId)
    setTechnicalLogId(null)
  }

  async function fetchAuditLogs() {
    if (!user) return
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/super-admin/audit-logs', {
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
      setAuditLogs(Array.isArray(json.auditLogs) ? json.auditLogs : [])
      setSummary(json.summary || null)
      setDataModelNotice(json.dataModelNotice || '')
    } catch (err: any) {
      console.error('Error fetching audit logs:', err)
      setError(err.message || 'Failed to connect to the audit logs API.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAuditLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const formatDateTime = (isoString: string | null) => {
    if (!isoString) return '—'
    try {
      return new Date(isoString).toLocaleString('en-AU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Australia/Adelaide',
      })
    } catch {
      return isoString
    }
  }

  const actionOptions = Array.from(new Set(auditLogs.map(l => l.action))).sort()

  const dateThreshold = (filter: DateFilter): number => {
    const now = Date.now()
    if (filter === '24h') return now - 24 * 60 * 60 * 1000
    if (filter === '7d') return now - 7 * 24 * 60 * 60 * 1000
    if (filter === '30d') return now - 30 * 24 * 60 * 60 * 1000
    return 0
  }

  const filteredLogs = auditLogs.filter(l => {
    const term = search.trim().toLowerCase()
    const matchSearch =
      !term ||
      (l.performedByEmail || '').toLowerCase().includes(term) ||
      (l.performedBy || '').toLowerCase().includes(term) ||
      (l.action || '').toLowerCase().includes(term) ||
      (l.tenantId || '').toLowerCase().includes(term) ||
      (l.targetUserEmail || '').toLowerCase().includes(term) ||
      (l.targetOrganisationName || '').toLowerCase().includes(term) ||
      (l.reason || '').toLowerCase().includes(term) ||
      (l.dogName || '').toLowerCase().includes(term) ||
      (l.details || '').toLowerCase().includes(term)

    const matchAction = filterAction === 'all' || l.action === filterAction
    const matchRole = filterRole === 'all' || (l.actorRole || 'unknown') === filterRole
    const matchDate = filterDate === 'all' || (l.createdAt && new Date(l.createdAt).getTime() >= dateThreshold(filterDate))

    return matchSearch && matchAction && matchRole && matchDate
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: '#1a3a2a' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading platform activity trail...</p>
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
          onClick={fetchAuditLogs}
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
        <h2>Audit Logs</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#53635a' }}>
          Phase 2 administrative activity with target identity, reasons, and state changes.
        </p>
      </section>

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

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="super-admin-module-card">
          <span>RECENT EVENTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#10291d' }}>{summary?.totalRecentEvents ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>LAST 24 HOURS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#085041' }}>{summary?.eventsLast24h ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>UNIQUE ACTORS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>{summary?.uniqueActors ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>UNIQUE ORGANISATIONS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#1a3a2a' }}>{summary?.uniqueTenants ?? 0}</h3>
        </div>
        <div className="super-admin-module-card">
          <span>DELETION EVENTS</span>
          <h3 style={{ fontSize: 26, margin: '6px 0 0', fontWeight: 700, color: '#c53030' }}>{summary?.deletionEvents ?? 0}</h3>
        </div>
      </section>

      {/* Filter Toolbar */}
      <div className="super-admin-panel" style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: '#fcfcfc' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>SEARCH (ACTOR / EMAIL / ACTION / TENANT)</label>
          <input
            type="text"
            className="form-input"
            style={{ width: '100%', padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)' }}
            placeholder="Search actor, email, action, tenant, details..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ACTION</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
          >
            <option value="all">All Actions</option>
            {actionOptions.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>ACTOR ROLE</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
          >
            <option value="all">All Roles</option>
            <option value="breeder">Breeder</option>
            <option value="owner">Owner</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', marginBottom: 4 }}>DATE</label>
          <select
            className="form-select"
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
            value={filterDate}
            onChange={e => setFilterDate(e.target.value as DateFilter)}
          >
            <option value="all">All</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="super-admin-panel" style={{ padding: 20 }}>
        <div className="super-admin-panel-header" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Platform Activity</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, background: '#eef5f0', color: '#1a3a2a', padding: '4px 8px', borderRadius: 4, fontWeight: 600 }}>
              {filteredLogs.length} Filtered
            </span>
            <button
              type="button"
              disabled
              title="Coming later"
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: '#f4f6f5', color: '#9aa39d', cursor: 'not-allowed' }}
            >
              Export — Coming later
            </button>
          </div>
        </div>

        <div>
          {filteredLogs.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6c7a70', padding: '30px 0', textAlign: 'center' }}>No events match the active search filters.</p>
          ) : (
            <table className="super-admin-audit-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #dfe5df', textAlign: 'left', color: '#6c7a70' }}>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Timestamp</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Actor</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Action</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Target</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>Organisation</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(l => {
                  const isExpanded = expandedLogId === l.id
                  const isTechnicalExpanded = technicalLogId === l.id
                  const detailPanelId = `audit-details-${l.id}`
                  const technicalPanelId = `audit-technical-${l.id}`
                  return (
                  <Fragment key={l.id}>
                  <tr className="super-admin-audit-row" style={{ borderBottom: isExpanded ? 0 : '1px solid #f4f6f5' }}>
                    <td data-label="Timestamp" style={{ padding: '10px 8px', color: '#53635a', whiteSpace: 'nowrap' }}>{formatDateTime(l.createdAt)}</td>
                    <td data-label="Actor" style={{ padding: '10px 8px', color: '#10291d', fontWeight: 600 }}>{l.performedByEmail || l.performedBy || 'System'}</td>
                    <td data-label="Action" style={{ padding: '10px 8px' }}>
                      <div>{ACTION_LABELS[l.action] || l.action}</div>
                      <button
                        type="button"
                        className="super-admin-audit-toggle"
                        aria-expanded={isExpanded}
                        aria-controls={detailPanelId}
                        onClick={() => toggleLogDetails(l.id)}
                      >
                        {isExpanded ? '▴ Hide details' : '▾ View details'}
                      </button>
                    </td>
                    <td data-label="Target" style={{ padding: '10px 8px', color: '#53635a', overflowWrap: 'anywhere' }}>{l.targetUserEmail || l.targetUserId || l.dogName || l.dogId || 'Legacy target not recorded'}</td>
                    <td data-label="Organisation" style={{ padding: '10px 8px', overflowWrap: 'anywhere' }}>
                      {l.targetOrganisationId || l.tenantId ? (
                        l.targetOrganisationId || l.tenantIsOrganisation ? (
                          <Link to={`/app/super-admin/organisations/${l.targetOrganisationId || l.tenantId}`} style={{ color: '#085041', fontWeight: 600 }}>
                            {l.targetOrganisationName || `${(l.targetOrganisationId || l.tenantId)!.slice(0, 8)}…`}
                          </Link>
                        ) : (
                          <span style={{ color: '#53635a' }}>{l.targetOrganisationName || `${l.tenantId!.slice(0, 8)}…`}</span>
                        )
                      ) : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="super-admin-audit-detail-row">
                      <td colSpan={5}>
                        <section id={detailPanelId} className="super-admin-audit-details" aria-label={`Details for ${ACTION_LABELS[l.action] || l.action}`}>
                          <div className="super-admin-audit-detail-summary">
                            <div><strong>Reason</strong><span>{l.reason || 'Legacy reason not recorded'}</span></div>
                            <div><strong>Target</strong><span>{l.targetUserEmail || l.dogName || 'Legacy target not recorded'}{l.targetUserId || l.dogId ? ` (${l.targetUserId || l.dogId})` : ''}</span></div>
                            <div><strong>Organisation</strong><span>{l.targetOrganisationName || 'Not recorded'}{l.targetOrganisationId || l.tenantId ? ` (${l.targetOrganisationId || l.tenantId})` : ''}</span></div>
                            <div><strong>Action / type</strong><span>{ACTION_LABELS[l.action] || l.action} · {l.isDeletionEvent ? 'Deletion' : 'Standard'}{l.actorRole ? ` · ${l.actorRole}` : ''}</span></div>
                            <div className="super-admin-audit-detail-wide"><strong>Details</strong><span>{l.details || 'Legacy details not recorded'}</span></div>
                          </div>
                          <div className="super-admin-audit-state-grid">
                            <div><strong>Before state</strong><span>{auditStateSummary(l.beforeState)}</span></div>
                            <div><strong>After state</strong><span>{auditStateSummary(l.afterState)}</span></div>
                          </div>
                          <button
                            type="button"
                            className="super-admin-audit-technical-toggle"
                            aria-expanded={isTechnicalExpanded}
                            aria-controls={technicalPanelId}
                            onClick={() => setTechnicalLogId(current => current === l.id ? null : l.id)}
                          >
                            {isTechnicalExpanded ? 'Hide technical data' : 'Show technical data'}
                          </button>
                          {isTechnicalExpanded && (
                            <div id={technicalPanelId} className="super-admin-audit-technical-grid">
                              <div><strong>Before JSON</strong><pre>{auditStateDetails(l.beforeState)}</pre></div>
                              <div><strong>After JSON</strong><pre>{auditStateDetails(l.afterState)}</pre></div>
                            </div>
                          )}
                          <div className="super-admin-audit-detail-actions">
                            <Link to={`/app/super-admin/audit-logs/${l.id}`} className="btn btn-secondary btn-sm">Open event</Link>
                            {l.performedBy && <Link to={`/app/super-admin/users/${l.performedBy}`} className="btn btn-secondary btn-sm">View actor</Link>}
                          </div>
                        </section>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
