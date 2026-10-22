import { createHash } from 'node:crypto'
import { dispatchAccountOperation } from './account-external-operations.js'
import { categoryEmailEnabled } from './manual-reminder-delivery.js'
import { ApiError } from './http-helpers.js'

// The durable identity is the care event, not its rendered wording or recipient
// address. A failed source-record stamp must not create another 'once' send on
// tomorrow's cron. Daily notifications deliberately use separate UTC days.
export function scheduledReminderEmailKey({ projectId, uid, dogId, eventType, sourceId, milestone, frequency, now }) {
  if (![projectId, uid, dogId, eventType, sourceId, milestone].every(value => typeof value === 'string' && value.trim().length > 0)
      || !['once', 'daily'].includes(frequency) || !(now instanceof Date) || !Number.isFinite(+now)) throw new Error('INVALID_REMINDER_IDENTITY')
  return createHash('sha256').update(JSON.stringify([
    'scheduled-reminder-email-v1', projectId, uid, dogId, eventType, sourceId, milestone,
    frequency === 'daily' ? now.toISOString().slice(0, 10) : 'once',
  ])).digest('hex')
}

export async function sendScheduledReminderEmail({ db, sendEmail, ...identity }) {
  if (typeof identity.recipientEmail !== 'string' || !identity.recipientEmail.trim()) throw new Error('REMINDER_RECIPIENT_REQUIRED')
  const operationKey = scheduledReminderEmailKey(identity)
  const accepted = await dispatchAccountOperation({
    db, uid: identity.uid, dogId: identity.dogId, kind: 'reminder_email', operationKey,
    // Re-read at admission and immediately before provider dispatch. A cron
    // snapshot is not permission to ignore a later category opt-out or send
    // private dog details to an address removed from the account.
    validate: async tx => {
      const user = (await tx.get(db.collection('users').doc(identity.uid))).data()
      if (!user || !categoryEmailEnabled(user, identity.eventType) || user.email !== identity.recipientEmail) {
        throw new ApiError(409, 'Reminder preferences or recipient changed')
      }
    },
    invoke: sendEmail, confirmed: value => value === true,
  })
  if (accepted !== true) throw new Error('REMINDER_EMAIL_UNCONFIRMED')
  return { sent: true }
}
