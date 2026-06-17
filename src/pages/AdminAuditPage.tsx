import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getFullAuditHistoryForDog, getUserProfile, type AuditEntry } from '../lib/db'
import { collection, getDocs, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface DogOption {
  id: string
  name: string
  passportId: string
  tenantId: string
}

const ADMIN_EMAIL = 'trunghieungo@gmail.com'

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

export default function AdminAuditPage({ toast }: Props) {
  const { user } = useAuth()
  const [dogs, setDogs] = useState<DogOption[]>([])
  const [selectedDogId, setSelectedDogId] = useState('')
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [tenantProfiles, setTenantProfiles] = useState<Record<string, { name: string; kennelName: string; email: string; phone: string; address: string }>>({})
  const [expandedOwnerTenant, setExpandedOwnerTenant] = useState<string | null>(null)
  const [loadingDogs, setLoadingDogs] = useState(true)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [search, setSearch] = useState('')

  // Admin only — same pattern as AdminSurveyPage
  if (user?.email !== ADMIN_EMAIL) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Admin only</div>
      </div>
    )
  }

  // Load every dog across every tenant so the admin can search by name or
  // passport ID, regardless of who currently owns it. This is the only
  // page in the app that queries `dogs` without a tenantId filter — by
  // design, since admin oversight is cross-tenant.
  useEffect(() => {
    async function loadAllDogs() {
      try {
        const snap = await getDocs(query(collection(db, 'dogs')))
        const all = snap.docs.map(d => {
          const data = d.data() as any
          return { id: d.id, name: data.name || 'Unnamed', passportId: data.passportId || '', tenantId: data.tenantId || '' }
        })
        setDogs(all)
      } catch {
        toast('Failed to load dog list', 'error')
      } finally {
        setLoadingDogs(false)
      }
    }
    loadAllDogs()
  }, [])

  async function loadHistory(dogId: string) {
    setSelectedDogId(dogId)
    if (!dogId) { setLogs([]); return }
    setLoadingLogs(true)
    try {
      const entries = await getFullAuditHistoryForDog(dogId)
      setLogs(entries)

      // Look up the full name / kennel name for each distinct tenant that
      // appears in this dog's history, so the admin sees who "Owner #1"
      // actually is rather than just an email address.
      const uniqueTenantIds = Array.from(new Set(entries.map(e => e.tenantId).filter(Boolean)))
      const profiles: Record<string, { name: string; kennelName: string; email: string; phone: string; address: string }> = {}
      await Promise.all(uniqueTenantIds.map(async tid => {
        try {
          const profile = await getUserProfile(tid)
          if (profile) {
            profiles[tid] = {
              name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unknown',
              kennelName: profile.kennelName || '',
              email: profile.email || '',
              phone: profile.phone || '',
              address: profile.address || '',
            }
          }
        } catch {
          // if a profile can't be found, the UI just falls back to email
        }
      }))
      setTenantProfiles(profiles)
    } catch {
      toast('Failed to load audit history', 'error')
    } finally {
      setLoadingLogs(false)
    }
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  const filteredDogs = dogs.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.passportId.toLowerCase().includes(search.toLowerCase())
  )

  // Detect tenant changes across the log timeline so we can visually mark
  // where an ownership transfer split the history into "before" and
  // "after" segments — this is the cross-tenant view a normal user never
  // sees in their own Activity tab.
  const sortedAsc = [...logs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const tenantAtIndex = new Map<string, number>()
  let tenantSeq = 0
  for (const entry of sortedAsc) {
    if (!tenantAtIndex.has(entry.tenantId)) {
      tenantAtIndex.set(entry.tenantId, tenantSeq++)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
          Admin: Full Audit History
        </h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>
          Cross-tenant history for a single dog, spanning any ownership transfers. Not visible to breeders or owners — admin only.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          type="text"
          placeholder="Search by dog name or passport ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="form-select"
          style={{ maxWidth: 320 }}
          value={selectedDogId}
          onChange={e => loadHistory(e.target.value)}
          disabled={loadingDogs}
        >
          <option value="">{loadingDogs ? 'Loading dogs…' : 'Select a dog…'}</option>
          {filteredDogs.map(d => (
            <option key={d.id} value={d.id}>{d.name} — {d.passportId || d.id}</option>
          ))}
        </select>
      </div>

      {!selectedDogId ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">Select a dog to view its full history</div>
          <div className="empty-state-desc">Includes activity from every owner this dog has ever had.</div>
        </div>
      ) : loadingLogs ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No recorded activity for this dog</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {logs.map((log, i) => {
            const config = ACTION_CONFIG[log.action] || { icon: '📝', color: 'var(--mid)', label: log.action }
            const ownerIndex = tenantAtIndex.get(log.tenantId) ?? 0
            const profile = tenantProfiles[log.tenantId]
            return (
              <div
                key={log.id}
                style={{
                  background: 'var(--white)',
                  borderRadius: i === 0 ? '12px 12px 0 0' : i === logs.length - 1 ? '0 0 12px 12px' : 0,
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderTop: '1px solid var(--border)',
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${config.color}`,
                  marginBottom: 1,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `${config.color}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', flexShrink: 0,
                }}>
                  {config.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: config.color }}>{config.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--mid)', background: 'var(--sand)', padding: '1px 8px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Owner #{ownerIndex + 1}{profile ? ` — ${profile.name}${profile.kennelName ? ` (${profile.kennelName})` : ''}` : ''}
                      {profile && (
                        <button
                          onClick={() => setExpandedOwnerTenant(expandedOwnerTenant === log.tenantId ? null : log.tenantId)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: 'var(--green)', fontWeight: 700 }}
                          title="Show contact details"
                        >
                          ⓘ
                        </button>
                      )}
                    </span>
                  </div>
                  {expandedOwnerTenant === log.tenantId && profile && (
                    <div style={{ fontSize: 12, color: 'var(--mid)', background: 'var(--sand)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                      <div>📧 {profile.email || '—'}</div>
                      <div>📞 {profile.phone || '—'}</div>
                      <div>📍 {profile.address || '—'}</div>
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--mid)' }}>{log.details}</div>
                  <div style={{ fontSize: 11, color: 'var(--light)', marginTop: 2 }}>
                    {log.performedByEmail || profile?.email || 'System'} · {formatTime(log.createdAt)} · tenant {log.tenantId.slice(0, 8)}…
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
