import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getDogs, getAllPendingReminders, claimTransferredDogs } from '../lib/db'
import { formatDate, isOverdue, getDogAge, LIFE_STAGE_EMOJI } from '../lib/utils'
import type { Dog, Reminder, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function DashboardPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [dogs, setDogs] = useState<Dog[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDogs(),
      getAllPendingReminders().catch(() => [] as Reminder[]),
    ])
      .then(([d, r]) => { setDogs(d); setReminders(r.slice(0, 5)); setLoading(false) })
      .catch(() => { toast('Failed to load data', 'error'); setLoading(false) })
  }, [])

  // Auto-claim any dogs transferred to this user's email
  useEffect(() => {
    if (!user?.email) return
    claimTransferredDogs(user.uid, user.email).then(count => {
      if (count > 0) {
        toast(`${count} dog${count > 1 ? 's' : ''} transferred to your account 🐾`, 'success')
        // Reload dogs to show newly claimed ones
        getDogs().then(setDogs).catch(() => {})
      }
    }).catch(() => {})
  }, [user])

  const activeDogs = dogs.filter(d => (d as any).status !== 'transferred')
  const overdueCount = reminders.filter(r => isOverdue(r.dueDate)).length

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (loading) return (
    <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: 32 }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
          {greeting}, {profile?.firstName || profile?.kennelName} 👋
        </h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>
          {profile?.kennelName} · {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
        <StatCard value={activeDogs.length} label="Dogs registered" icon="🐕" />
        <StatCard value={activeDogs.filter(d => !d.isDeceased).length} label="Active profiles" icon="✓" color="var(--green)" />
        <StatCard value={overdueCount} label="Overdue reminders" icon="🔔" color={overdueCount > 0 ? 'var(--error)' : undefined} />
        <StatCard value={activeDogs.filter(d => d.lifeStage === 'puppy').length} label="Puppies" icon="🐶" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* Dogs */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Your dogs</h2>
            <Link to="/app/dogs/new" className="btn btn-primary btn-sm">+ Add dog</Link>
          </div>

          {dogs.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">🐾</div>
                <div className="empty-state-title">No dogs yet</div>
                <div className="empty-state-desc">Add your first dog to get started. It takes about 2 minutes.</div>
                <Link to="/app/dogs/new" className="btn btn-primary" style={{ marginTop: 8 }}>Add your first dog</Link>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeDogs.slice(0, 8).map(dog => (
                <DogRow key={dog.id} dog={dog} />
              ))}
              {activeDogs.length > 8 && (
                <Link to="/app/dogs" style={{ textAlign: 'center', padding: '12px', fontSize: 13, color: 'var(--green)', textDecoration: 'none', background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  View all {activeDogs.length} dogs →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Reminders sidebar */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Reminders</h2>
            {overdueCount > 0 && (
              <span className="badge badge-red">{overdueCount} overdue</span>
            )}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {reminders.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 13, color: 'var(--light)' }}>All up to date</div>
              </div>
            ) : (
              reminders.map((r, i) => (
                <div key={r.id} style={{
                  padding: '12px 16px',
                  borderBottom: i < reminders.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isOverdue(r.dueDate) ? 'var(--error)' : 'var(--warning)',
                    flexShrink: 0, marginTop: 6,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: isOverdue(r.dueDate) ? 'var(--error)' : 'var(--light)' }}>
                      {isOverdue(r.dueDate) ? 'Overdue · ' : 'Due · '}{formatDate(r.dueDate)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* View all reminders link */}
          <Link
            to="/app/reminders"
            style={{
              display: 'block', marginTop: 8, textAlign: 'center',
              fontSize: 13, color: 'var(--green)', textDecoration: 'none',
              padding: '8px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--white)',
            }}
          >
            View all reminders →
          </Link>

          {/* NSW compliance notice */}
          <div style={{
            marginTop: 16,
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--green-light)',
            border: '1px solid rgba(8,80,65,.12)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--green)', marginBottom: 3 }}>NSW compliance</div>
            <div style={{ fontSize: 12, color: '#0F6E56', lineHeight: 1.5 }}>
              Puppy Farm Act 2024 is active. Your records are audit-ready.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ value, label, icon, color }: { value: number; label: string; icon: string; color?: string }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px' }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: color || 'var(--dark)', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--light)' }}>{label}</div>
    </div>
  )
}

function DogRow({ dog }: { dog: Dog }) {
  return (
    <Link to={`/app/dogs/${dog.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        transition: 'border-color 0.12s',
        cursor: 'pointer',
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--green)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: dog.profilePhoto ? undefined : 'var(--green-light)',
          backgroundImage: dog.profilePhoto ? `url(${dog.profilePhoto})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          {!dog.profilePhoto && LIFE_STAGE_EMOJI[dog.lifeStage]}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--dark)' }}>{dog.name}</div>
          <div style={{ fontSize: 12, color: 'var(--light)' }}>{dog.breed} · {dog.sex === 'female' ? '♀' : '♂'} · {getDogAge(dog.dateOfBirth)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(dog as any).status === 'transferred' ? (
            <span className="badge badge-gray" style={{ fontSize: 10 }}>Transferred</span>
          ) : (
            <span className="badge badge-green" style={{ fontSize: 10 }}>QR ✓</span>
          )}
          <span style={{ fontSize: 16, color: 'var(--border)' }}>›</span>
        </div>
      </div>
    </Link>
  )
}
