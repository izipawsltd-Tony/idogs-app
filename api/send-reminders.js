// api/send-reminders.js — Daily cron: check due dates and send reminders
// Called by GitHub Actions cron job daily at 8am AEST

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const db = getFirestore()
const sns = new SNSClient({
  region: process.env.AWS_SNS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_SNS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SNS_SECRET_ACCESS_KEY,
  },
})

async function sendSMS(phone, message) {
  const command = new PublishCommand({
    Message: message,
    PhoneNumber: phone,
    MessageAttributes: {
      'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'iDogs' },
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    },
  })
  return sns.send(command)
}

function formatDate(str) {
  if (!str) return ''
  try {
    return new Date(str).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return str }
}

// Server-side equivalent of ordinal() in src/lib/utils.ts — duplicated
// rather than imported for the same reason as getTodaysDogMilestone
// below. FIX (bug found via staging screenshot: Timeline showing "2th
// birthday", "3th birthday" instead of "2nd", "3rd"): the previous
// inline logic only special-cased 1, hardcoding "th" for every other
// number.
function ordinal(n) {
  const lastTwoDigits = n % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

// Server-side equivalent of getTodaysMilestone in src/lib/utils.ts —
// duplicated rather than imported since this file runs in a different
// module environment (Vercel serverless function) than the frontend
// bundle. Keep both in sync if the milestone logic changes.
function getTodaysDogMilestone(dateOfBirth, createdAt) {
  const today = new Date()

  if (dateOfBirth) {
    const birth = new Date(dateOfBirth)
    if (birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate()) {
      const years = today.getFullYear() - birth.getFullYear()
      if (years > 0) {
        return { kind: 'birthday', years, label: `${ordinal(years)} birthday` }
      }
    }
  }

  if (createdAt) {
    const joined = new Date(createdAt)
    if (joined.getMonth() === today.getMonth() && joined.getDate() === today.getDate()) {
      const years = today.getFullYear() - joined.getFullYear()
      if (years > 0) {
        return { kind: 'anniversary', years, label: `${years} year${years > 1 ? 's' : ''}` }
      }
    }
  }

  return null
}

export default async function handler(req, res) {
  // Security: only allow from GitHub Actions or internal
  const authHeader = req.headers['x-cron-secret']
  if (authHeader !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const today = new Date()
    let smsSent = 0
    let emailSent = 0

    // Get all users with SMS enabled and phone number
    const usersSnap = await db.collection('users')
      .where('emailReminders', '!=', false)
      .get()

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data()
      const tenantId = userDoc.id
      const reminderDays = user.reminderDays || 7
      const reminderFrequency = user.reminderFrequency || 'once' // 'once' | 'daily'
      const hasSmsAddon = user.smsAddon === true
      const phone = user.phone

      // Get all dogs for this user
      const dogsSnap = await db.collection('dogs')
        .where('tenantId', '==', tenantId)
        .where('status', '!=', 'transferred')
        .get()

      for (const dogDoc of dogsSnap.docs) {
        const dog = dogDoc.data()

        // Birthday / join-anniversary check — separate from the vaccine
        // due-date logic below, this fires at most once per dog per day
        // regardless of how many vaccine records exist.
        if (user.email) {
          const dogCreatedAt = dog.createdAt?.toDate ? dog.createdAt.toDate() : new Date(dog.createdAt)
          const milestone = getTodaysDogMilestone(dog.dateOfBirth, dogCreatedAt)
          if (milestone) {
            try {
              await fetch(`${process.env.APP_URL || 'https://idogs.com.au'}/api/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: user.email,
                  subject: `${milestone.kind === 'birthday' ? '🎂' : '🏠'} ${dog.name}'s ${milestone.label}`,
                  html: `<p>Hi ${user.firstName || 'there'},</p><p><strong>${dog.name}</strong> ${milestone.kind === 'birthday' ? `is celebrating their ${milestone.label} today!` : `joined iDogs ${milestone.label} ago today!`} 🎉</p><p><a href="https://idogs.com.au/app/dogs/${dogDoc.id}">View ${dog.name}'s story →</a></p><p style="color:#9A9891;font-size:12px">iDogs · idogs.com.au · <a href="https://idogs.com.au/app/settings">Manage reminders</a></p>`,
                }),
              })
              emailSent++
            } catch (e) {
              console.error('Milestone email error:', e)
            }
          }
        }

        // Check vaccine records
        const vaccinesSnap = await db.collection('vaccineRecords')
          .where('dogId', '==', dogDoc.id)
          .get()

        for (const vDoc of vaccinesSnap.docs) {
          const vaccine = vDoc.data()
          if (!vaccine.nextDue) continue

          const dueDate = new Date(vaccine.nextDue)
          const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24))

          // Fire once the reminder window has been reached (daysUntilDue
          // <= reminderDays) rather than requiring an exact match. An
          // exact-match comparison meant that if the cron job missed the
          // single day a reminder was due to fire (server downtime, a
          // failed deploy, GitHub Actions being delayed, etc.), that
          // reminder would never fire again — daysUntilDue only ever
          // equals a specific number once. Using <= means a missed day
          // is recovered on the next run instead of being lost forever.
          //
          // Whether we then re-send on subsequent days depends on the
          // user's reminderFrequency preference: 'once' sends a single
          // email per vaccine record (any existing lastReminderSentAt
          // blocks further sends), 'daily' sends every day the window is
          // active, capped at one per ~20h to avoid double-sends if the
          // cron job somehow runs twice in a day.
          const hasSentBefore = Boolean(vaccine.lastReminderSentAt)
          const sentWithinLast20h = hasSentBefore &&
            (today - new Date(vaccine.lastReminderSentAt)) < 1000 * 60 * 60 * 20
          const blockedByFrequencyPref = reminderFrequency === 'once' ? hasSentBefore : sentWithinLast20h

          if (daysUntilDue <= reminderDays && daysUntilDue >= 0 && !blockedByFrequencyPref) {
            const msg = `🐾 iDogs Reminder: ${dog.name}'s ${vaccine.name} is due ${daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`} (${formatDate(vaccine.nextDue)}). Book your vet now.`

            // Send email reminder
            if (user.email) {
              try {
                await fetch(`${process.env.APP_URL || 'https://idogs.com.au'}/api/send-email`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to: user.email,
                    subject: `🐾 Reminder: ${dog.name}'s ${vaccine.name} due ${daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`}`,
                    html: `<p>Hi ${user.firstName || 'there'},</p><p><strong>${dog.name}'s ${vaccine.name}</strong> is due on <strong>${formatDate(vaccine.nextDue)}</strong>.</p><p>Book your vet appointment soon to keep ${dog.name} protected.</p><p><a href="https://idogs.com.au/app/dogs/${dogDoc.id}">View ${dog.name}'s records →</a></p><p style="color:#9A9891;font-size:12px">iDogs · idogs.com.au · <a href="https://idogs.com.au/app/settings">Manage reminders</a></p>`,
                  }),
                })
                emailSent++
              } catch (e) {
                console.error('Email reminder error:', e)
              }
            }

            // Send SMS if addon enabled and phone exists
            if (hasSmsAddon && phone) {
              try {
                // Format AU phone to E.164
                const e164 = phone.replace(/\s/g, '').replace(/^0/, '+61')
                await sendSMS(e164, msg)
                smsSent++
              } catch (e) {
                console.error('SMS reminder error:', e)
              }
            }

            // Record when this reminder fired so we don't re-send it
            // again tomorrow for the same vaccine — without this, every
            // run from now until the due date would re-trigger the email.
            try {
              await db.collection('vaccineRecords').doc(vDoc.id).update({
                lastReminderSentAt: today.toISOString(),
              })
            } catch (e) {
              console.error('Failed to record lastReminderSentAt:', e)
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true, smsSent, emailSent })
  } catch (err) {
    console.error('Reminders error:', err)
    return res.status(500).json({ error: 'Failed to send reminders', message: String(err) })
  }
}
