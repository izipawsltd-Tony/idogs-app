// api/reconcile-dog-cap.js — trusted server-side cap correction for iDogs
// Pricing v1.1 (Pricing_Decision_Record_v1.1.md §3.2, LOCKED).
//
// createDog() (src/lib/db.ts) still writes the new dog directly via the
// client SDK, preserving its existing battle-tested atomic passport-
// reservation transaction unchanged — but that means a Free account
// creating a 3rd (or later) dog has no server-side check stopping the
// active count from briefly exceeding its cap the instant that write
// lands. This endpoint is the correction step: the client calls it right
// after createDog() succeeds (see db.ts), and it re-reads the account's
// TRUE active-dog set inside a transaction and demotes anything beyond
// the current plan's cap back to 'restricted' — the same
// earliest-created-stays-active default used everywhere else in this
// pricing model (§3.3). Also reused by api/set-dog-status.js's callers
// indirectly is unnecessary (that endpoint does its own cap check
// per-action) — this one exists specifically for the "just created a new
// dog" and "plan just changed some other way" reconciliation cases.
//
// Never blocks dog creation and never deletes data — only ever moves a
// dog's `status` between 'active' and 'restricted'.
//
// POST /api/reconcile-dog-cap
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { demoted: string[] }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, withApiErrorHandling } from './_lib/http-helpers.js'
import { reconcileDogCapTx } from './_lib/dog-cap.js'
import { computeEffectivePlan } from './_lib/entitlements.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'Method not allowed')
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    throw new ApiError(401, 'Missing Authorization header')
  }

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }

  const db = getFirestore()
  const userRef = db.collection('users').doc(uid)

  const result = await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef)
    const profile = userSnap.exists ? userSnap.data() : {}
    const plan = computeEffectivePlan(profile)
    return reconcileDogCapTx(tx, db, uid, plan)
  })

  return res.status(200).json({ demoted: result.demoted })
}

export default withApiErrorHandling('reconcile-dog-cap', handler)
