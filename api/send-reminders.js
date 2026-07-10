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

// Dogs eligible for reminder processing under `tenantId` — mirrors the
// ownership rule getDogs() uses client-side. tenantId permanently stays
// the original breeder (needed for historical/audit records), so a plain
// tenantId query would keep matching a dog forever, even after a buyer
// claims it (status resets to 'active' on claim). currentOwnerId is the
// source of truth for who should actually be reminded/emailed/SMS'd:
//  - currentOwnerId missing → legacy record, fall back to tenantId
//  - currentOwnerId === tenantId → still owned by this user, include
//  - currentOwnerId !== tenantId → claimed by someone else, exclude
//  - status === 'transferred' → pendingClaim, no active owner yet, exclude
// The currentOwnerId query below also lets a buyer who has claimed a dog
// start receiving its reminders under their own tenantId once processed.
async function getReminderEligibleDogs(tenantId) {
  const [byTenant, byOwner] = await Promise.all([
    db.collection('dogs').where('tenantId', '==', tenantId).get(),
    db.collection('dogs').where('currentOwnerId', '==', tenantId).get(),
  ])

  const dogs = new Map()

  byTenant.docs.forEach(d => {
    const data = d.data()
    if (data.status === 'transferred') return
    if (data.currentOwnerId && data.currentOwnerId !== tenantId) return
    dogs.set(d.id, { id: d.id, ...data })
  })

  byOwner.docs.forEach(d => {
    const data = d.data()
    if (data.status === 'transferred') return
    dogs.set(d.id, { id: d.id, ...data })
  })

  return Array.from(dogs.values())
}

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

    // Get all users — emailReminders check is done per-user below
    // to avoid Firestore inequality query issues when the field is absent
    const usersSnap = await db.collection('users').get()

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data()
      // Skip users who have explicitly disabled email reminders
      if (user.emailReminders === false) continue
      const tenantId = userDoc.id
      const reminderDays = user.reminderDays || 7
      const reminderFrequency = user.reminderFrequency || 'once' // 'once' | 'daily'
      const heatReminderDays = user.heatReminderDays || 14 // separate setting for heat cycles
      const hasSmsAddon = user.smsAddon === true
      const phone = user.phone

      // Get dogs currently owned by this user — see getReminderEligibleDogs()
      // for why this isn't a plain tenantId query.
      const dogs = await getReminderEligibleDogs(tenantId)

      for (const dog of dogs) {
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
                headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
                body: JSON.stringify({
                  to_email: user.email,
                  to_name: user.firstName || 'there',
                  subject: `${milestone.kind === 'birthday' ? '🎂' : '🏠'} ${dog.name}'s ${milestone.label}`,
                  message: `<p>Hi ${user.firstName || 'there'},</p><p><strong>${dog.name}</strong> ${milestone.kind === 'birthday' ? `is celebrating their ${milestone.label} today!` : `joined iDogs ${milestone.label} ago today!`} 🎉</p><p><a href="https://idogs.com.au/app/dogs/${dog.id}">View ${dog.name}'s story →</a></p><p style="color:#9A9891;font-size:12px">iDogs · idogs.com.au · <a href="https://idogs.com.au/app/settings">Manage reminders</a></p>`,
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
          .where('dogId', '==', dog.id)
          .get()

        // Auto-resolve reminders for superseded vaccines.
        // A vaccine is superseded if another record of the same "group"
        // (C3/C4/C5 share one group; other vaccines match by name) has a
        // later dateGiven. We mark the reminder completed so it stops
        // showing as overdue in the UI without the user needing to do it manually.
        const allVaccines = vaccinesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const groupKey = (name) => {
          const n = (name || '').trim().toLowerCase()
          return /\bc[3-5]\b/.test(n) ? '__core_combo__' : n
        }
        const latestByGroup = {}
        for (const v of allVaccines) {
          const key = groupKey(v.name)
          if (!latestByGroup[key] || v.dateGiven > latestByGroup[key].dateGiven) {
            latestByGroup[key] = v
          }
        }
        for (const v of allVaccines) {
          const key = groupKey(v.name)
          const isSuperseded = latestByGroup[key]?.id !== v.id
          if (isSuperseded) {
            // Mark the reminder for this vaccine as completed
            try {
              const reminderId = `vaccine_${dog.id}_${v.id}`
              const reminderRef = db.collection('reminders').doc(reminderId)
              const existing = await reminderRef.get()
              if (existing.exists && existing.data()?.status !== 'completed') {
                await reminderRef.update({
                  status: 'completed',
                  completedAt: today.toISOString(),
                  completedReason: 'superseded_by_newer_vaccine',
                  updatedAt: today.toISOString(),
                })
              }
            } catch (e) {
              // non-critical
            }
          }
        }

        for (const vDoc of vaccinesSnap.docs) {
          const vaccine = vDoc.data()
          if (!vaccine.nextDue) continue

          // Skip superseded vaccines — their reminders were resolved above
          const key = groupKey(vaccine.name)
          if (latestByGroup[key]?.id !== vDoc.id) continue

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

          // FIX 1: extend window to -30 so overdue vaccines are still
          // caught (previously daysUntilDue >= 0 silently dropped any
          // vaccine that had already passed its due date).
          const isInWindow = daysUntilDue <= reminderDays && daysUntilDue >= -365

          if (isInWindow) {
            const isOverdue = daysUntilDue < 0
            const dueLabelShort = isOverdue
              ? `overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? 's' : ''}`
              : daysUntilDue === 0 ? 'today'
              : daysUntilDue === 1 ? 'tomorrow'
              : `in ${daysUntilDue} days`

            // FIX 2: upsert a reminder record into Firestore so the
            // Reminders tab in the app shows the due/overdue item.
            // Key by dogId + vaccineId so re-runs don't create duplicates.
            try {
              const reminderId = `vaccine_${dog.id}_${vDoc.id}`
              const reminderRef = db.collection('reminders').doc(reminderId)
              const existingReminder = await reminderRef.get()

              // Only create/update if not already completed by the user
              if (!existingReminder.exists || existingReminder.data()?.status !== 'completed') {
                await reminderRef.set({
                  id: reminderId,
                  dogId: dog.id,
                  tenantId,
                  title: `${vaccine.name} due ${dueLabelShort}`,
                  dueDate: vaccine.nextDue,
                  type: 'vaccine',
                  vaccineId: vDoc.id,
                  status: isOverdue ? 'overdue' : 'pending',
                  createdAt: today.toISOString(),
                  updatedAt: today.toISOString(),
                }, { merge: true })
              }
            } catch (e) {
              console.error('Failed to upsert reminder record:', e)
            }

            // Only send email/SMS once (or per frequency pref) —
            // but always upsert the Firestore record above regardless
            if (!blockedByFrequencyPref) {
              const msg = `🐾 iDogs Reminder: ${dog.name}'s ${vaccine.name} is ${dueLabelShort} (${formatDate(vaccine.nextDue)}). Book your vet now.`

              // Send email reminder
              if (user.email) {
                try {
                  await fetch(`${process.env.APP_URL || 'https://idogs.com.au'}/api/send-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
                    body: JSON.stringify({
                      to_email: user.email,
                      to_name: user.firstName || 'there',
                      subject: isOverdue
                        ? `⚠️ ${dog.name}'s ${vaccine.name} is overdue!`
                        : `🐾 Reminder: ${dog.name}'s ${vaccine.name} due ${dueLabelShort}`,
                      message: `<p>Hi ${user.firstName || 'there'},</p><p><strong>${dog.name}'s ${vaccine.name}</strong> ${isOverdue ? `was due on <strong>${formatDate(vaccine.nextDue)}</strong> and is now overdue.` : `is due on <strong>${formatDate(vaccine.nextDue)}</strong>.`}</p><p>Book your vet appointment ${isOverdue ? 'as soon as possible' : 'soon'} to keep ${dog.name} protected.</p><p><a href="https://idogs.com.au/app/dogs/${dog.id}">View ${dog.name}'s records →</a></p><p style="color:#9A9891;font-size:12px">iDogs · idogs.com.au · <a href="https://idogs.com.au/app/settings">Manage reminders</a></p>`,
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
                  const e164 = phone.replace(/\s/g, '').replace(/^0/, '+61')
                  await sendSMS(e164, msg)
                  smsSent++
                } catch (e) {
                  console.error('SMS reminder error:', e)
                }
              }

              // Record when this reminder fired
              try {
                await db.collection('vaccineRecords').doc(vDoc.id).update({
                  lastReminderSentAt: today.toISOString(),
                })
              } catch (e) {
                console.error('Failed to record lastReminderSentAt:', e)
              }
            }
          } else if (daysUntilDue > reminderDays) {
            // Vaccine not yet due — ensure any old reminder is marked pending
            // (handles the case where a due date was edited to be further away)
            try {
              const reminderId = `vaccine_${dog.id}_${vDoc.id}`
              const reminderRef = db.collection('reminders').doc(reminderId)
              const existing = await reminderRef.get()
              if (existing.exists && existing.data()?.status === 'overdue') {
                await reminderRef.update({ status: 'pending', updatedAt: today.toISOString() })
              }
            } catch (e) {
              // non-critical
            }
          }
        }

        // ── HEAT CYCLE REMINDERS (female dogs only) ──────────────────
        // Predict upcoming heats from DOB + breed, upsert reminder records
        // and send email/SMS when a heat is within reminderDays window.
        if (dog.sex === 'female' && dog.dateOfBirth && dog.status !== 'transferred') {
          const LARGE_BREEDS = ['Labrador Retriever','Golden Retriever','German Shepherd','Rottweiler','Bernese Mountain Dog','Great Dane','Irish Wolfhound','St Bernard','Alaskan Malamute','Newfoundland','Leonberger','Dobermann','Weimaraner','Vizsla','Rhodesian Ridgeback','Boxer','Dalmatian','Standard Poodle','Afghan Hound','Greyhound','Bloodhound']
          const GIANT_BREEDS = ['Great Dane','Irish Wolfhound','St Bernard','Alaskan Malamute','Newfoundland','Leonberger','Mastiff','Bullmastiff','Tibetan Mastiff']
          const SMALL_BREEDS = ['Chihuahua','Pomeranian','Maltese','Yorkshire Terrier','Toy Poodle','Shih Tzu','Cavalier King Charles Spaniel','Pug','French Bulldog','Boston Terrier','Papillon','Miniature Pinscher']

          const breedSize = GIANT_BREEDS.includes(dog.breed) ? 'giant' : LARGE_BREEDS.includes(dog.breed) ? 'large' : SMALL_BREEDS.includes(dog.breed) ? 'small' : 'medium'
          const firstHeatMonths = breedSize === 'giant' ? 18 : breedSize === 'large' ? 10 : breedSize === 'small' ? 6 : 8
          const heatIntervalMonths = breedSize === 'giant' ? 10 : breedSize === 'large' ? 7 : breedSize === 'small' ? 5 : 6
          const minBreedingMonths = (breedSize === 'large' || breedSize === 'giant') ? 18 : 12

          function addMonthsLocal(date, months) {
            const d = new Date(date)
            d.setMonth(d.getMonth() + months)
            return d
          }

          const dob = new Date(dog.dateOfBirth)
          const anchorDate = dog.firstHeatDate ? new Date(dog.firstHeatDate) : addMonthsLocal(dob, firstHeatMonths)

          // Generate next 4 heats from anchor
          for (let i = 0; i < 4; i++) {
            const heatDate = addMonthsLocal(anchorDate, heatIntervalMonths * i)
            const heatNum = i + 1
            const daysUntil = Math.ceil((heatDate - today) / (1000 * 60 * 60 * 24))

            // Only process heats within window or upcoming in next 60 days
            if (daysUntil < -14 || daysUntil > 60) continue

            // Compliance check
            const ageAtHeatMonths = (heatDate.getFullYear() - dob.getFullYear()) * 12 + (heatDate.getMonth() - dob.getMonth())
            const isEligible = ageAtHeatMonths >= minBreedingMonths
            const isFirstHeat = heatNum === 1
            const currentAgeMonths = (today.getFullYear() - dob.getFullYear()) * 12 + (today.getMonth() - dob.getMonth())

            // Age guard: adult female dog > 18 months should not get "First heat" reminders
            if (isFirstHeat && currentAgeMonths > 18) {
              continue
            }

            const heatLabel = isFirstHeat ? 'First heat (skip — Dogs SA rule)' :
              !isEligible ? `Heat ${heatNum} (not yet eligible — under ${minBreedingMonths} months)` :
              `Heat ${heatNum} — eligible to breed`

            const reminderId = `heat_${dog.id}_cycle${heatNum}`
            const status = daysUntil < 0 ? 'overdue' : 'pending'

            // Upsert reminder record
            try {
              const reminderRef = db.collection('reminders').doc(reminderId)
              const existing = await reminderRef.get()
              if (!existing.exists || existing.data()?.status !== 'completed') {
                await reminderRef.set({
                  id: reminderId,
                  dogId: dog.id,
                  tenantId,
                  title: `${dog.name} — ${heatLabel}`,
                  dueDate: heatDate.toISOString().split('T')[0],
                  type: 'heat',
                  heatNumber: heatNum,
                  isEligible,
                  isFirstHeat,
                  status,
                  createdAt: today.toISOString(),
                  updatedAt: today.toISOString(),
                }, { merge: true })
              }
            } catch (e) {
              console.error('Failed to upsert heat reminder:', e)
            }

            // Send email/SMS notification when within heatReminderDays window
            if (daysUntil <= heatReminderDays && daysUntil >= -7) {
              const sentKey = `lastHeatReminderSentAt_cycle${heatNum}`
              const lastSent = dog[sentKey]
              const sentWithin20h = lastSent && (today - new Date(lastSent)) < 1000 * 60 * 60 * 20

              if (!sentWithin20h) {
                const dueLabel = daysUntil === 0 ? 'today' : daysUntil < 0 ? `${Math.abs(daysUntil)} days ago` : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`
                const complianceNote = isFirstHeat
                  ? '⚠️ This is her first heat — Dogs SA rules require skipping the first cycle before breeding.'
                  : !isEligible
                  ? `⚠️ She will be ${ageAtHeatMonths} months old — Dogs SA requires at least ${minBreedingMonths} months for ${breedSize} breeds.`
                  : `✓ She will be ${ageAtHeatMonths} months old — eligible to breed under Dogs SA rules.`

                if (user.email) {
                  try {
                    await fetch(`${process.env.APP_URL || 'https://idogs.com.au'}/api/send-email`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
                      body: JSON.stringify({
                        to_email: user.email,
                        to_name: user.firstName || 'there',
                        subject: `🌸 ${dog.name}'s Heat ${heatNum} expected ${dueLabel}`,
                        message: `<p>Hi ${user.firstName || 'there'},</p><p><strong>${dog.name}'s Heat ${heatNum}</strong> is expected ${dueLabel} (${formatDate(heatDate.toISOString().split('T')[0])}).</p><p>${complianceNote}</p><p><a href="https://idogs.com.au/app/dogs/${dog.id}">View ${dog.name}'s breeding record →</a></p><p style="color:#9A9891;font-size:12px">iDogs · idogs.com.au · <a href="https://idogs.com.au/app/settings">Manage reminders</a></p>`,
                      }),
                    })
                    emailSent++
                  } catch (e) {
                    console.error('Heat email error:', e)
                  }
                }

                if (hasSmsAddon && phone) {
                  try {
                    const e164 = phone.replace(/\s/g, '').replace(/^0/, '+61')
                    await sendSMS(e164, `🌸 iDogs: ${dog.name}'s Heat ${heatNum} expected ${dueLabel}. ${isFirstHeat ? 'Skip first heat (Dogs SA rule).' : isEligible ? '✓ Eligible to breed.' : `Not eligible yet — ${minBreedingMonths}mo min.`}`)
                    smsSent++
                  } catch (e) {
                    console.error('Heat SMS error:', e)
                  }
                }

                // Record send time on dog document
                try {
                  await db.collection('dogs').doc(dog.id).update({
                    [sentKey]: today.toISOString(),
                  })
                } catch (e) {
                  console.error('Failed to record heat reminder sent:', e)
                }
              }
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
