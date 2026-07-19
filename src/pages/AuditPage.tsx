import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getAuditLogs, getDogs, type AuditEntry } from '../lib/db'
import type { Dog, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const ACTION_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  dog_created:        { icon: '🐕', color: 'var(--brand-600)', label: 'Dog added' },
  dog_updated:        { icon: '✏️', color: '#5C5A54',           label: 'Dog updated' },
  dog_deleted:        { icon: '🗑', color: 'var(--danger)',      label: 'Dog deleted' },
  dog_transferred:    { icon: '🔄', color: 'var(--gold-500)',    label: 'Ownership transferred' },
  vaccine_added:      { icon: '💉', color: 'var(--brand-600)', label: 'Vaccine added' },
  vaccine_deleted:    { icon: '💉', color: 'var(--danger)',      label: 'Vaccine deleted' },
  health_test_added:  { icon: '🔬', color: 'var(--brand-600)', label: 'Health test added' },
  health_test_deleted:{ icon: '🔬', color: 'var(--danger)',      label: 'Health test deleted' },
  worming_added:      { icon: '💊', color: 'var(--brand-600)', label: 'Worming added' },
  worming_deleted:    { icon: '💊', color: 'var(--danger)',      label: 'Worming deleted' },
  document_uploaded:  { icon: '📄', color: 'var(--brand-600)', label: 'Document uploaded' },
  reminder_completed: { icon: '✅', color: 'var(--brand-600)', label: 'Reminder completed' },
  litter_created:     { icon: '🐣', color: 'var(--brand-600)', label: 'Litter created' },
  puppy_added:        { icon: '🐶', color: 'var(--brand-600)', label: 'Puppy added' },
}

export default function AuditPage({ toast }: Props) {
  const { user } = useAuth()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [dogs, setDogs] = useState<Dog[]>([])
  const [loading, setLoading] = useState(true)
  // Codex round 14: distinct from `logs` being genuinely empty — a
  // failed load (getAuditLogs, or the getDogs() call this page also
  // makes for the dog filter dropdown) must never render as "No
  // activity yet" indefinitely. The toast alone is transient and easy
  // to miss.
  const [loadError, setLoadError] = useState(false)
  const [filterDog, setFilterDog] = useState('')
  const [filterAction, setFilterAction] = useState('')

  function loadAudit() {
    if (!user) return
    setLoading(true)
    setLoadError(false)
    Promise.all([
      getAuditLogs(user.uid),
      getDogs(),
    ]).then(([l, d]) => {
      setLogs(l)
      setDogs(d)
    }).catch(() => { setLoadError(true); toast('Failed to load audit log', 'error') })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function formatTime(iso: string) {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  const filtered = logs.filter(l => {
    if (filterDog && l.dogId !== filterDog) return false
    if (filterAction && l.action !== filterAction) return false
    return true
  })

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Activity</h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>
          {logs.length} update{logs.length !== 1 ? 's' : ''} on your dogs — a record of what's been added, changed, or removed.
        </p>
        <p style={{ fontSize: 12, color: 'var(--light)', marginTop: 6 }}>
          This only shows activity from your own account. If a dog is transferred to a new owner, they start their own activity history — your past entries stay private to you.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ maxWidth: 200 }} value={filterDog} onChange={e => setFilterDog(e.target.value)}>
          <option value="">All dogs</option>
          {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 220 }} value={filterAction} onChange={e => setFilterAction(e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTION_CONFIG).map(([key, val]) => (
            <option key={key} value={key}>{val.icon} {val.label}</option>
          ))}
        </select>
        {(filterDog || filterAction) && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilterDog(''); setFilterAction('') }}>
            Clear filters
          </button>
        )}
      </div>

      {loadError ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <div className="empty-state-title">Couldn't load your activity</div>
          <div className="empty-state-desc">This is a loading error, not an empty history. Please try again.</div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={loadAudit}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">{logs.length === 0 ? 'No activity yet' : 'No matching activity'}</div>
          <div className="empty-state-desc">{logs.length === 0 ? 'Adding vaccines, uploading documents, and other updates will show up here.' : 'Try clearing the filters.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((log, i) => {
            const config = ACTION_CONFIG[log.action] || { icon: '📝', color: 'var(--mid)', label: log.action }
            return (
              <div
                key={log.id}
                style={{
                  background: 'var(--white)',
                  borderRadius: i === 0 ? '12px 12px 0 0' : i === filtered.length - 1 ? '0 0 12px 12px' : 0,
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderTop: `1px solid var(--border)`,
                  borderRight: `1px solid var(--border)`,
                  borderBottom: `1px solid var(--border)`,
                  borderLeft: `3px solid ${config.color}`,
                  marginBottom: 1,
                  transition: 'background 0.1s',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `${config.color}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', flexShrink: 0,
                }}>
                  {config.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: config.color }}>{config.label}</span>
                    {log.dogName && (
                      <span style={{ fontSize: 12, color: 'var(--mid)', background: 'var(--sand)', padding: '1px 8px', borderRadius: 10 }}>
                        🐾 {log.dogName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--mid)' }}>{log.details}</div>
                  <div style={{ fontSize: 11, color: 'var(--light)', marginTop: 2 }}>
                    {log.performedByEmail || 'System'} · {formatTime(log.createdAt)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
