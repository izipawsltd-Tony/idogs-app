import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  getDogs, getAllPendingReminders,
  getLitters, getAllDocumentsForUser, getAuditLogs,
} from '../lib/db'
import type { AuditEntry } from '../lib/db'
import { formatDate, isOverdue, getDogAge, LIFE_STAGE_EMOJI } from '../lib/utils'
import type { Dog, Reminder, Litter, Document, ToastMessage } from '../types'
import LoadingScreen from '../components/ui/LoadingScreen'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

// ── helpers ──────────────────────────────────────────────────────────────────

function auditIcon(action: string): string {
  if (action.startsWith('dog')) return '🐕'
  if (action.startsWith('vaccine')) return '💉'
  if (action.startsWith('health')) return '🏥'
  if (action.startsWith('worming')) return '💊'
  if (action === 'document_uploaded') return '📄'
  if (action === 'reminder_completed') return '✓'
  if (action.startsWith('litter') || action === 'puppy_added') return '🐣'
  if (action === 'life_stage_changed') return '🌱'
  return '📋'
}

function auditLabel(entry: AuditEntry): string {
  const n = entry.dogName ? ` — ${entry.dogName}` : ''
  switch (entry.action) {
    case 'dog_created':       return `Dog added${n}`
    case 'dog_updated':       return `Dog updated${n}`
    case 'dog_deleted':       return 'Dog deleted'
    case 'dog_transferred':   return `Dog transferred${n}`
    case 'vaccine_added':     return `Vaccine added${n}`
    case 'vaccine_deleted':   return 'Vaccine removed'
    case 'health_test_added': return `Health test added${n}`
    case 'health_test_deleted': return 'Health test removed'
    case 'worming_added':     return `Worming added${n}`
    case 'worming_deleted':   return 'Worming removed'
    case 'document_uploaded': return `Document uploaded${n}`
    case 'reminder_completed': return 'Reminder completed'
    case 'litter_created':    return 'Litter created'
    case 'puppy_added':       return 'Puppy added to litter'
    case 'life_stage_changed': return `Life stage updated${n}`
    default: return entry.details || entry.action
  }
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function docCategoryLabel(cat: Document['category']): string {
  const MAP: Record<string, string> = {
    pedigree: 'Pedigree', vaccine_cert: 'Vaccine cert',
    health_test: 'Health test', contract: 'Contract',
    photo: 'Photo', other: 'Other',
  }
  return MAP[cat] ?? cat
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DashboardPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [dogs,           setDogs]           = useState<Dog[]>([])
  const [reminders,      setReminders]      = useState<Reminder[]>([])
  const [litters,        setLitters]        = useState<Litter[]>([])
  const [documents,      setDocuments]      = useState<Document[]>([])
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([])
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      getDogs(),
      getAllPendingReminders().catch(() => [] as Reminder[]),
      getLitters().catch(() => [] as Litter[]),
      getAllDocumentsForUser(user.uid).catch(() => [] as Document[]),
      getAuditLogs(user.uid).catch(() => [] as AuditEntry[]),
    ])
      .then(([d, r, l, docs, audit]) => {
        setDogs(d)
        setReminders(r)
        setLitters(l)
        setDocuments(docs)
        setRecentActivity(audit.slice(0, 5))
        setLoading(false)
      })
      .catch(() => { toast('Failed to load data', 'error'); setLoading(false) })
  }, [user])

  const activeDogs   = dogs.filter(d => (d as any).status !== 'transferred' && (d as any).transferStatus !== 'pendingClaim')
  const overdueCount = reminders.filter(r => r.status !== 'completed' && isOverdue(r.dueDate)).length
  const visibleReminders = reminders.slice(0, 5)

  if (loading) return <LoadingScreen />

  const isOwner = profile?.role === 'owner'

  const STATS = [
    { value: activeDogs.length,                                     label: 'Dogs',              icon: '🐕',  link: '/app/dogs',      color: undefined },
    { value: activeDogs.filter(d => !d.isDeceased).length,         label: 'Active profiles',   icon: '✓',   link: '/app/dogs',      color: 'var(--brand-600)' },
    { value: overdueCount,                                          label: 'Overdue reminders', icon: '🔔',  link: '/app/reminders?filter=overdue', color: overdueCount > 0 ? 'var(--danger)' : undefined },
    { value: activeDogs.filter(d => d.lifeStage === 'puppy').length, label: 'Puppies',          icon: '🐾',  link: '/app/dogs?stage=puppies',      color: undefined },
    ...(!isOwner || litters.length > 0 ? [{ value: litters.length, label: 'Litters', icon: '🐣', link: '/app/litters', color: undefined }] : []),
    { value: documents.length,                                      label: 'Documents',         icon: '📄',  link: '/app/documents', color: undefined },
  ]

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
        {STATS.map(s => (
          <Link key={s.label} to={s.link} style={{ textDecoration: 'none' }}>
            <div className="card card-shadow" style={{ padding: '16px 18px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: s.color ?? 'var(--brand-900)', lineHeight: 1, marginBottom: 4 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>{s.label}</div>
              <div style={{ fontSize: 11, color: 'var(--brand-600)', marginTop: 8, fontWeight: 500 }}>View all →</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Main panels ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Recent Dogs */}
          <PanelCard title="Recent Dogs" viewAllTo="/app/dogs" viewAllLabel={`View all ${activeDogs.length} →`} action={<Link to="/app/dogs/new" className="btn btn-primary btn-sm">{profile?.role === 'owner' ? '+ Create Dog ID' : '+ Add dog'}</Link>}>
            {activeDogs.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div className="empty-state-icon">🐾</div>
                <div className="empty-state-title">No dogs yet</div>
                <div className="empty-state-desc">Add your first dog to get started.</div>
                <Link to="/app/dogs/new" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>Add your first dog</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeDogs.slice(0, 5).map(dog => <DogRow key={dog.id} dog={dog} />)}
              </div>
            )}
          </PanelCard>

          {/* Litters Overview — hidden for pet owners unless they actually have litters */}
          {(!isOwner || litters.length > 0) && (
            <PanelCard title="Litters Overview" viewAllTo="/app/litters" viewAllLabel="View all litters →">
              {litters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--light)', fontSize: 13 }}>
                  No litters recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {litters.slice(0, 4).map(litter => (
                    <div key={litter.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 'var(--radius-md)',
                      background: 'var(--gray-100)',
                    }}>
                      <span style={{ fontSize: 18 }}>🐣</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--brand-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {litter.name || 'Unnamed litter'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--light)' }}>
                          {litter.actualBirthDate
                            ? `Born ${formatDate(litter.actualBirthDate)}`
                            : litter.expectedDueDate
                              ? `Due ${formatDate(litter.expectedDueDate)}`
                              : 'Date not set'}
                          {litter.puppyIds.length > 0 && ` · ${litter.puppyIds.length} pup${litter.puppyIds.length !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                      <span className={litter.actualBirthDate ? 'badge badge-active' : 'badge badge-gray'}>
                        {litter.actualBirthDate ? 'Active' : 'Planned'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </PanelCard>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Upcoming Reminders */}
          <PanelCard title="Upcoming Reminders" viewAllTo="/app/reminders" viewAllLabel="View all →"
            badge={overdueCount > 0 ? <span className="badge badge-red">{overdueCount} overdue</span> : undefined}
          >
            {visibleReminders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>✓</div>
                <div style={{ fontSize: 13, color: 'var(--light)' }}>All up to date</div>
              </div>
            ) : (
              <div>
                {visibleReminders.map((r, i) => (
                  <div key={r.id} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '10px 0',
                    borderBottom: i < visibleReminders.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                      background: isOverdue(r.dueDate) ? 'var(--danger)' : 'var(--warning)',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--brand-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 11, color: isOverdue(r.dueDate) ? 'var(--danger)' : 'var(--light)' }}>
                        {isOverdue(r.dueDate) ? 'Overdue · ' : 'Due · '}{formatDate(r.dueDate)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>

          {/* Documents */}
          <PanelCard title="Documents" viewAllTo="/app/documents" viewAllLabel="View all →">
            {documents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--light)', fontSize: 13 }}>
                No documents uploaded yet.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--brand-900)', fontFamily: 'var(--font-display)', marginBottom: 8 }}>
                  {documents.length}
                  <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--light)', marginLeft: 6 }}>documents</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {documents.slice(0, 3).map(doc => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--light)' }}>{docCategoryLabel(doc.category)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </PanelCard>

          {/* Recent Activity */}
          <PanelCard title="Recent Activity" viewAllTo="/app/audit" viewAllLabel="Full history →">
            {recentActivity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--light)', fontSize: 13 }}>
                No activity recorded yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentActivity.map(entry => (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{auditIcon(entry.action)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {auditLabel(entry)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--light)' }}>{timeAgo(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>

          {/* NSW compliance banner */}
          <div style={{
            padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--brand-50)',
            border: '1px solid rgba(46, 125, 78, 0.15)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 4 }}>
              NSW Puppy Farm Act 2024
            </div>
            <div style={{ fontSize: 12, color: 'var(--brand-900)', lineHeight: 1.5 }}>
              Compliance is active. Your records are audit-ready.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Panel card ────────────────────────────────────────────────────────────────

function PanelCard({
  title, viewAllTo, viewAllLabel, action, badge, children,
}: {
  title: string
  viewAllTo?: string
  viewAllLabel?: string
  action?: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="card card-shadow">
      {/* flexWrap so title + action + "View all" stack instead of forcing
          a minimum row width wider than a narrow mobile viewport — this
          header pattern is shared by every dashboard panel. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--brand-900)', margin: 0 }}>
            {title}
          </h2>
          {badge}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {action}
          {viewAllTo && viewAllLabel && (
            <Link to={viewAllTo} style={{ fontSize: 12, color: 'var(--brand-600)', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {viewAllLabel}
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Dog row ───────────────────────────────────────────────────────────────────

function DogRow({ dog }: { dog: Dog }) {
  return (
    <Link to={`/app/dogs/${dog.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)', background: 'var(--white)',
        cursor: 'pointer', transition: 'border-color 0.12s',
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--brand-600)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: dog.profilePhoto ? undefined : 'var(--brand-50)',
          backgroundImage: dog.profilePhoto ? `url(${dog.profilePhoto})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>
          {!dog.profilePhoto && LIFE_STAGE_EMOJI[dog.lifeStage]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Long single-word names (no spaces, e.g. underscore-joined test
              names) have no natural wrap point — without truncation they
              force this row (and everything up the flex chain) wider than
              a mobile viewport. Ellipsis needs both minWidth:0 above (so
              the flex item can actually shrink) and overflow:hidden here. */}
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--brand-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dog.name}</div>
          <div style={{ fontSize: 11, color: 'var(--light)' }}>
            {dog.breed} · {dog.sex === 'female' ? '♀' : '♂'} · {getDogAge(dog.dateOfBirth)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(dog as any).status === 'transferred'
            ? <span className="badge badge-closed" style={{ fontSize: 10 }}>Transferred</span>
            : <span className="badge badge-active" style={{ fontSize: 10 }}>Active</span>
          }
          <span style={{ color: 'var(--light)', fontSize: 14 }}>›</span>
        </div>
      </div>
    </Link>
  )
}
