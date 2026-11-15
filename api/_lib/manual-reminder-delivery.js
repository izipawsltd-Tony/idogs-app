import { createHash, randomUUID } from 'node:crypto'

export const CARE_TYPES = ['worming', 'vaccination', 'flea_tick', 'medication', 'vet_appointment', 'custom', 'grooming', 'weight_check', 'dental_care', 'nail_trim']
const DAY = 86400000
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function categoryEmailEnabled(user, type) {
  return user.emailReminders !== false && user.careEmailTypes?.[type === 'vaccine' ? 'vaccination' : type] !== false
}

export function manualReminderEligible({ user, reminder, dog, tenantId, now }) {
  if (!user || !reminder || !dog || user.manualReminderEmails !== true || !user.email) return false
  if (!categoryEmailEnabled(user, reminder.type) || !CARE_TYPES.includes(reminder.type)) return false
  if (reminder.source !== 'manual' || reminder.tenantId !== tenantId || !['pending', 'overdue'].includes(reminder.status)) return false
  const owner = Object.hasOwn(dog, 'currentOwnerId') ? dog.currentOwnerId : dog.tenantId
  if (owner !== tenantId || dog.status === 'transferred' || dog.isDeceased) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reminder.dueDate || '')) return false
  const due = new Date(`${reminder.dueDate}T00:00:00Z`)
  if (!Number.isFinite(+due) || due.toISOString().slice(0, 10) !== reminder.dueDate) return false
  const lead = reminder.notifyDaysBefore
  if (!Number.isInteger(lead) || lead < 0 || lead > 30) return false
  const today = Date.parse(now.toISOString().slice(0, 10))
  const days = (+due - today) / DAY
  // Catch up missed once-only runs, but never email a year-old backlog.
  return days <= lead && days >= (user.reminderFrequency === 'daily' ? 0 : -14)
}

// All I/O is injected. Tests exercise transactions and delivery without credentials.
export async function deliverManualReminder({ db, reminderId, tenantId, now, sendEmail, projectId, appUrl }) {
  if (!projectId || !appUrl) throw new Error('MANUAL_REMINDER_CONFIG_REQUIRED')
  const reminderRef = db.collection('reminders').doc(reminderId)
  const userRef = db.collection('users').doc(tenantId)
  const leaseId = randomUUID()
  const claim = await db.runTransaction(async tx => {
    const reminder = (await tx.get(reminderRef)).data()
    const user = (await tx.get(userRef)).data()
    if (!reminder?.dogId) return null
    const dog = (await tx.get(db.collection('dogs').doc(reminder.dogId))).data()
    if (!manualReminderEligible({ user, reminder, dog, tenantId, now })) return null
    const daily = user.reminderFrequency === 'daily' ? now.toISOString().slice(0, 10) : 'once'
    const key = createHash('sha256').update(JSON.stringify([projectId, tenantId, reminderId, reminder.dogId, reminder.dueDate, daily])).digest('hex')
    const ref = db.collection('reminderEmailDeliveries').doc(key)
    const previous = (await tx.get(ref)).data()
    if (previous?.status === 'sent' || previous?.status === 'review_required') return null
    if (previous?.leaseUntil > +now) return null
    // Resend retains idempotency keys for 24h. Stop automatic retries before
    // that expires: an ambiguous provider success must never be sent twice.
    if (previous && +now - previous.startedAt >= 23 * 3600000) {
      tx.set(ref, { ...previous, status: 'review_required', leaseUntil: 0 })
      return null
    }
    const payload = {
      to: [user.email],
      from: 'iDogs <noreply@idogs.com.au>',
      subject: `iDogs reminder: ${String(dog.name || 'Your dog').replace(/[\r\n]/g, ' ').slice(0, 100)} — ${String(reminder.title).replace(/[\r\n]/g, ' ').slice(0, 200)}`,
      html: `<p>${escapeHtml(dog.name)}: ${escapeHtml(reminder.title)}</p><p>Due date: ${escapeHtml(reminder.dueDate)}</p><p><a href="${escapeHtml(appUrl)}/app/reminders">Open your reminders</a></p><p>Manage email preferences in iDogs Settings.</p>`,
    }
    // Retry exactly the same provider request; changed email/content needs review.
    if (previous && JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
      tx.set(ref, { ...previous, status: 'review_required', leaseUntil: 0 })
      return null
    }
    const delivery = { status: 'sending', leaseId, leaseUntil: +now + 5 * 60000, startedAt: previous?.startedAt ?? +now, payload, tenantId, reminderId }
    tx.set(ref, delivery)
    return { ref, key, payload }
  })
  if (!claim) return { sent: false, reason: 'SKIPPED' }
  let sent = false
  try { sent = (await sendEmail(claim.payload, claim.key)) === true } catch { /* ambiguous: retry same key within 23h only */ }
  await db.runTransaction(async tx => {
    const current = (await tx.get(claim.ref)).data()
    if (current?.leaseId !== leaseId) return
    tx.set(claim.ref, { ...current, status: sent ? 'sent' : 'retry_pending', leaseUntil: 0, ...(sent ? { sentAt: now.toISOString() } : {}) })
  })
  return { sent, reason: sent ? 'SENT' : 'RETRY_PENDING' }
}
