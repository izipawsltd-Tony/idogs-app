import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getAllRemindersForUser, getDogs, completeReminder } from '../lib/db'
import { sendReminderEmail } from '../lib/email'
import { isOverdue, formatDate } from '../lib/utils'
import type { Dog, Reminder, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function RemindersPage({ toast }: Props) {
  const { user } = useAuth()
  const [reminders, setReminders] = useState<(Reminder & { dogName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState<'upcoming' | 'overdue' | 'all' | 'done'>('upcoming')

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    if (!user) return
    setLoading(true)
    try {
      const [remindersData, dogsData] = await Promise.all([
        getAllRemindersForUser(user.uid),
        getDogs(),
      ])
      const dogMap: Record<string, string> = {}
      dogsData.forEach((d: Dog) => { dogMap[d.id] = d.name })
      const enriched = remindersData.map(r => ({
        ...r,
        dogName: dogMap[r.dogId] || 'Unknown Dog',
      }))
      setReminders(enriched)
    } catch {
      toast('Failed to load reminders', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function markDone(reminderId: string) {
    try {
      await completeReminder(reminderId)
      setReminders(prev => prev.map(r => r.id === reminderId ? { ...r, status: 'completed' as const } : r))
      toast('Reminder marked as done ✓')
    } catch {
      toast('Failed to update reminder', 'error')
    }
  }

  async function handleSendEmail() {
    if (!user?.email) { toast('No email on your account', 'error'); return }

    const today = new Date()
    const in7Days = new Date(today)
    in7Days.setDate(today.getDate() + 7)

    const upcoming = reminders.filter(r => {
      if (r.status === 'completed') return false
      const due = new Date(r.dueDate)
      return due >= today && due <= in7Days
    })

    if (upcoming.length === 0) { toast('No reminders due in the next 7 days', 'info'); return }

    setSending(true)
    try {
      const reminderText = upcoming
        .map(r => `• ${r.dogName} — ${r.title} (due ${formatDate(r.dueDate)})`)
        .join('\n')

      await sendReminderEmail({
        ownerEmail: user.email,
        ownerName: user.displayName || 'there',
        date: today.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
        reminders: reminderText,
      })
      toast(`Reminder email sent to ${user.email} ✓`, 'success')
    } catch {
      toast('Failed to send email. Please try again.', 'error')
    } finally {
      setSending(false)
    }
  }

  function getDaysUntil(iso: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const due = new Date(iso); due.setHours(0, 0, 0, 0)
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  function getTypeIcon(title: string) {
    const t = (title || '').toLowerCase()
    if (t.includes('vacc')) return '💉'
    if (t.includes('worm')) return '💊'
    if (t.includes('vet')) return '🏥'
    return '🔔'
  }

  const upcomingCount = reminders.filter(r => {
    if (r.status === 'completed') return false
    const days = getDaysUntil(r.dueDate)
    return days >= 0 && days <= 7
  }).length

  const overdueCount = reminders.filter(r => r.status !== 'completed' && isOverdue(r.dueDate)).length

  const filtered = reminders.filter(r => {
    if (filter === 'upcoming') return r.status !== 'completed' && !isOverdue(r.dueDate)
    if (filter === 'overdue') return r.status !== 'completed' && isOverdue(r.dueDate)
    if (filter === 'done') return r.status === 'completed'
    return true
  })

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 12 }}>
      <div className="spinner" />
      <p style={{ fontSize: 14, color: 'var(--light)' }}>Loading reminders…</p>
    </div>
  )

  return (
    <div style={{ padding: 32 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Reminders</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>
            {overdueCount > 0 ? `${overdueCount} overdue · ` : ''}{upcomingCount} due in next 7 days
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSendEmail}
          disabled={sending || upcomingCount === 0}
          title={upcomingCount === 0 ? 'No upcoming reminders to send' : `Send ${upcomingCount} reminder(s) to ${user?.email}`}
        >
          {sending ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> Sending…</>
          ) : (
            <>✉️ Email me reminders</>
          )}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: overdueCount > 0 ? '#fff5f5' : 'var(--white)', border: `1px solid ${overdueCount > 0 ? '#fca5a5' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: overdueCount > 0 ? '#dc2626' : 'var(--dark)', lineHeight: 1 }}>{overdueCount}</div>
          <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>Overdue</div>
        </div>
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--dark)', lineHeight: 1 }}>{upcomingCount}</div>
          <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>Next 7 days</div>
        </div>
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'center', opacity: 0.7 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--dark)', lineHeight: 1 }}>{reminders.filter(r => r.status === 'completed').length}</div>
          <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>Completed</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['upcoming', 'overdue', 'all', 'done'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? 'var(--green)' : 'var(--white)',
              border: `1px solid ${filter === f ? 'var(--green)' : 'var(--border)'}`,
              color: filter === f ? '#fff' : 'var(--mid)',
              borderRadius: 20, padding: '6px 14px',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'overdue' && overdueCount > 0 && (
              <span style={{ background: filter === f ? 'rgba(255,255,255,0.25)' : '#dc2626', color: '#fff', borderRadius: 10, fontSize: 11, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                {overdueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Reminder list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔔</div>
          <div className="empty-state-title">No {filter} reminders</div>
          <div className="empty-state-desc">
            {filter === 'upcoming' ? 'All caught up! No reminders due in the next 7 days.' : `No ${filter} reminders found.`}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(reminder => {
            const overdue = isOverdue(reminder.dueDate) && reminder.status !== 'completed'
            const days = getDaysUntil(reminder.dueDate)
            const done = reminder.status === 'completed'
            return (
              <div
                key={reminder.id}
                style={{
                  background: done ? '#fafaf9' : 'var(--white)',
                  border: `1px solid ${overdue ? '#fca5a5' : 'var(--border)'}`,
                  borderLeft: overdue ? '3px solid #dc2626' : undefined,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 14,
                  opacity: done ? 0.6 : 1,
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--green-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.2rem', flexShrink: 0,
                }}>
                  {getTypeIcon(reminder.title)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)' }}>{reminder.dogName}</span>
                    {done ? (
                      <span className="badge badge-green" style={{ fontSize: 11 }}>Done</span>
                    ) : overdue ? (
                      <span className="badge badge-red" style={{ fontSize: 11 }}>Overdue {Math.abs(days)}d</span>
                    ) : days === 0 ? (
                      <span style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74', borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '2px 8px' }}>Due Today</span>
                    ) : days <= 3 ? (
                      <span style={{ background: '#fefce8', color: '#ca8a04', border: '1px solid #fde047', borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '2px 8px' }}>In {days}d</span>
                    ) : (
                      <span className="badge badge-green" style={{ fontSize: 11 }}>In {days}d</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--mid)' }}>{reminder.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 2 }}>Due {formatDate(reminder.dueDate)}</div>
                </div>

                {!done && (
                  <button
                    onClick={() => markDone(reminder.id)}
                    title="Mark as done"
                    style={{
                      background: 'var(--green-light)', border: '1px solid var(--green-mid)',
                      color: 'var(--green)', borderRadius: 8,
                      width: 36, height: 36, fontSize: '1rem', fontWeight: 700,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
