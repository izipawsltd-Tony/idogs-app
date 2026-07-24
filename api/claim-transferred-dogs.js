// api/claim-transferred-dogs.js — Auto-claim dogs transferred to this
// buyer's email, run once whenever a signed-in user loads the dashboard.
//
// WHY THIS EXISTS: firestore.rules now restrict reading/updating a dog
// to its breeder (tenantId) or current owner (currentOwnerId). A buyer
// who just created an account to claim a transferred dog is, by
// definition, NEITHER of those yet — the dog still belongs to the
// seller until the claim completes. The old client-side
// claimTransferredDogs() in db.ts tried to query+update the dog
// directly from the browser, which the new rules correctly block. This
// endpoint uses the Admin SDK (bypasses rules) to do that lookup+update
// safely server-side, after verifying the caller's identity via their
// Firebase ID token — the email used to match transferred dogs comes
// from the VERIFIED token claim, not anything the client could spoof.
//
// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md §4.4, LOCKED):
// "Transfer is never blocked by the recipient's quota. If the receiving
// account has no room, the incoming dog arrives with status ==
// restricted." The claim itself always succeeds regardless of quota —
// only which claimed dogs land 'active' vs 'restricted' depends on how
// much cap room the buyer's account has, computed inside the SAME
// transaction as the claim writes (see api/_lib/dog-cap.js) so a
// concurrent claim/dog-creation can't race the count. When multiple
// transferred dogs are claimed in one call, room is filled earliest-
// transferred-first — an arbitrary but deterministic and defensible tie
// break, consistent with the earliest-created-stays-active default used
// everywhere else in this pricing model (§3.3).
//
// POST /api/claim-transferred-dogs
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { claimed: number }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { capForPlan, getOwnedActiveDogsSorted } from './_lib/dog-cap.js'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  let uid, email
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
    email = decoded.email
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  if (!email) {
    return res.status(200).json({ claimed: 0 })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const action = body.action === 'check' ? 'check' : 'claim'

  const db = getFirestore()

  // Match on status === 'transferred' rather than transferStatus ===
  // 'pendingClaim'. transferDogOwnership() sets BOTH fields on every
  // new transfer, but production dogs transferred before this
  // rewrite only ever had `status: 'transferred'` — never
  // `transferStatus` at all (that field didn't exist yet). Querying
  // by transferStatus alone would silently orphan every
  // already-transferred production dog: they'd never appear as
  // claimable again, with no error and no visible sign anything was
  // wrong. status is the one field both the old and new transfer
  // paths always set, so it's the backward-compatible match.
  const buildQuery = () => db.collection('dogs')
    .where('buyerEmail', '==', email.toLowerCase())
    .where('status', '==', 'transferred')

  try {
    if (action === 'check') {
      const dogsSnap = await buildQuery().get()
      const dogs = []
      dogsSnap.forEach(d => {
        const data = d.data()
        dogs.push({
          id: d.id,
          name: data.name,
          breed: data.breed,
          profilePhoto: data.profilePhoto || null,
          transferredAt: data.transferredAt,
        })
      })
      return res.status(200).json({ dogs })
    }

    const result = await db.runTransaction(async tx => {
      // ── Reads first ──
      const dogsSnap = await tx.get(buildQuery())
      if (dogsSnap.empty) return { claimed: 0 }

      const userRef = db.collection('users').doc(uid)
      const userSnap = await tx.get(userRef)
      const profile = userSnap.exists ? userSnap.data() : {}
      const plan = computeEffectivePlan(profile)
      const cap = capForPlan(plan)
      const currentActive = await getOwnedActiveDogsSorted(tx, db, uid)
      let room = Math.max(0, cap - currentActive.length)

      const claimedDocs = dogsSnap.docs.slice().sort(
        (a, b) => String(a.data().transferredAt || '').localeCompare(String(b.data().transferredAt || ''))
      )

      // ── Writes ──
      const nowIso = new Date().toISOString()
      for (const d of claimedDocs) {
        const grantActive = room > 0
        if (grantActive) room--
        tx.update(d.ref, {
          // tenantId intentionally NOT updated — it must stay as the
          // original breeder's uid forever so their getDogs() still works.
          currentOwnerId: uid,
          status: grantActive ? 'active' : 'restricted',
          transferStatus: FieldValue.delete(),
          claimedAt: nowIso,
          claimedBy: uid,
          updatedAt: nowIso,
        })
      }
      return { claimed: claimedDocs.length }
    })

    return res.status(200).json({ claimed: result.claimed })
  } catch (err) {
    console.error('claim-transferred-dogs error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
