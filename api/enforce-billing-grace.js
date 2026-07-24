// api/enforce-billing-grace.js — daily cron: downgrade any account whose
// §4.2 7-day past_due grace period has expired (Pricing_Decision_Record_
// v1.1.md, LOCKED). Stripe's own dunning/retry schedule does not reliably
// fire a webhook event at exactly the 7-day mark, so this sweep is the
// mechanism that actually performs the downgrade once the deadline has
// passed — api/_lib/entitlements.js's computeEffectivePlan() already
// treats the account as Free for READ-time quota decisions the moment the
// grace window expires, but only this sweep persists that by writing
// plan:'free' and moving excess active dogs to 'restricted'
// (api/_lib/dog-cap.js reconcileDogCapTx). Never deletes data, at any
// stage — same contract as the Stripe webhook's downgrade paths.
//
// Same CRON_SECRET header pattern as api/send-reminders.js. Wire into a
// GitHub Actions daily schedule (see .github/workflows/daily-reminders.yml
// for the existing pattern) once staging secrets are configured — this
// file works standalone via workflow_dispatch/manual curl in the
// meantime.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { isPastDueGraceExpired } from './_lib/entitlements.js'
import { reconcileDogCapTx } from './_lib/dog-cap.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['x-cron-secret']
  if (authHeader !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const db = getFirestore()

  // Single where() — CLAUDE.md convention (no orderBy/composite index).
  const snap = await db.collection('users').where('subscriptionStatus', '==', 'past_due').get()

  let downgraded = 0
  let checked = 0
  const errors = []

  for (const docSnap of snap.docs) {
    checked++
    const profile = docSnap.data()
    // Already downgraded by a prior sweep or a webhook event — idempotent
    // no-op, never re-processed.
    if (profile.plan !== 'plus') continue
    if (!isPastDueGraceExpired(profile)) continue

    const uid = docSnap.id
    try {
      await db.runTransaction(async tx => {
        await reconcileDogCapTx(tx, db, uid, 'free')
        tx.set(docSnap.ref, { plan: 'free' }, { merge: true })
      })
      downgraded++
    } catch (err) {
      errors.push(uid)
      console.error('enforce-billing-grace: downgrade failed', { uid })
    }
  }

  return res.status(200).json({ checked, downgraded, failed: errors.length })
}
