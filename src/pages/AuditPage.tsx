import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getAuditLogs, getDogs, type AuditEntry } from '../lib/db'
import type { Dog, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const ACTION_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  dog_created:        { icon: '🐕', color: '#085041', label: 'Dog added' },
  dog_updated:        { icon: '✏️', color: '#5C5A54', label: 'Dog updated' },
  dog_deleted:        { icon: '🗑', color: '#C0392B', label: 'Dog deleted' },
  dog_transferred:    { icon: '🔄', color: '#C8971F', label: 'Ownership transferred' },
  vaccine_added:      { icon: '💉', color: '#085041', label: 'Vaccine added' },
  vaccine_deleted:    { icon: '💉', color: '#C0392B', label: 'Vaccine deleted' },
  health_test_added:  { icon: '🔬', color: '#085041', label: 'Health test added' },
  health_test_deleted:{ icon: '🔬', color: '#C0392B', label: 'Health test deleted' },
  worming_added:      { icon: '💊', color: '#085041', label: 'Worming added' },
  worming_deleted:    { icon: '💊', color: '#C0392B', label: 'Worming deleted' },
  document_uploaded:  { icon: '📄', color: '#085041', label: 'Document uploaded' },
  reminder_completed: { icon: '✅', color: '#085041', label: 'Reminder completed' },
  litter_created:     { icon: '🐣', color: '#085041', label: 'Litter created' },
  puppy_added:        { icon: '🐶', color: '#085041', label: 'Puppy added' },
}

export default function AuditPage({ toast }: Props) {
  const { user } = useAuth()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [dogs, setDogs] = useState<Dog[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDog, setFilterDog] = useState('')
  const [filterAction, setFilterAction] = useState('')

  useEffect(() => {
    if (!user) return
    Promise.all([
      getAuditLogs(user.uid),
      getDogs(),
    ]).then(([l, d]) => {
      setLogs(l)
      setDogs(d)
    }).catch(() => toast('Failed to load audit log', 'error'))
      .finally(() => setLoading(false))
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
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Audit Trail</h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>{logs.length} events recorded — full history of all changes.</p>
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

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">{logs.length === 0 ? 'No audit events yet' : 'No matching events'}</div>
          <div className="empty-state-desc">{logs.length === 0 ? 'Actions like adding vaccines, transferring dogs, and uploading documents will appear here.' : 'Try clearing the filters.'}</div>
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
