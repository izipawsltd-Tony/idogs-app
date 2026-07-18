// api/delete-litter.js — trusted server-side litter deletion (Codex
// round 4, Blocker 3; hardened Codex round 5, Blocker 2).
//
// WHY THIS EXISTS: round 3 implemented safe litter deletion as a CLIENT
// Firestore transaction, relying on firestore.rules' litters.delete rule
// (tenantId ownership only) plus the app's own client-side logic to
// decide which puppies to delete alongside it. Codex round 4 flagged
// that this rule has no way to verify puppy handling actually happened —
// a plain deleteDoc() call was equally permitted. firestore.rules now
// denies litters delete unconditionally for clients — this endpoint is
// the only path, and owns the ENTIRE decision itself (Admin SDK,
// bypasses Rules).
//
// Codex round 5, Blocker 2 — two further gaps:
//
// 1. Round 4's version only ever inspected litter.puppyIds (the FORWARD
//    reference) to find candidate dogs. A dog whose OWN litterId points
//    at this litter but was never added to puppyIds (a partial write —
//    e.g. a dog created, then the litter-link step failed or was done
//    out of band) was invisible to this endpoint entirely: not deleted,
//    not preserved, not even considered — silently orphaned as far as
//    this operation's own accounting was concerned. This endpoint now
//    ALSO queries dogs directly by litterId (the REVERSE direction) and
//    reconciles both directions via resolveLitterMembership — see
//    api/_lib/litter-eligibility.js's own comment on confirmed/
//    forward-only/reverse-only.
//
// 2. Round 4's version always hard-deleted the litter document once
//    eligible puppies were removed, even when a PRESERVED (history-
//    bearing/transferred/claimed) dog still had its litterId pointing at
//    it — leaving that dog's lineage reference dangling (pointing at a
//    document that no longer exists). This endpoint now ARCHIVES the
//    litter instead of hard-deleting it whenever any preserved dog is
//    still linked — the litter document persists (so litterId always
//    resolves to something real) but is marked `archived: true` and
//    excluded from the breeder's normal Litters list (see
//    src/lib/db.ts's getLitters()). Only when NO preserved dog remains
//    linked (from either direction) is the litter document actually
//    deleted.
//
// Codex round 6, Blocker 1: round 5's archive-vs-delete decision only
// looked at `preserved` (CONFIRMED members that fail isDogSafeToDetach)
// — it never considered REVERSE-ONLY dogs (found only via the litterId
// query above, never in puppyIds) at all. Round 5's own "never touch
// ambiguous dogs" policy means a reverse-only dog is correctly never
// deleted or mutated — but that same dog's litterId STILL points at
// litterId, so if the litter had zero CONFIRMED-preserved members it
// would previously be hard-deleted anyway, leaving that untouched
// reverse-only dog with a now-dangling litterId reference. Hard deletion
// is now gated on BOTH preserved.length === 0 AND reverseOnly.length ===
// 0 — any dog whose own record still points at this litter, confirmed or
// not, keeps the litter document alive.
//
// POST /api/delete-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId }
// Returns: { deletedCount, preservedCount, ambiguousCount, litterDeleted, litterArchived } | { error }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { resolveLitterMembership, partitionConfirmedMembers } from './_lib/litter-eligibility.js'

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

  const body = parseJsonBody(req)
  const { litterId } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }

  const db = getFirestore()
  const litterRef = db.collection('litters').doc(litterId)

  const outcome = await db.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) {
      return { deletedCount: 0, preservedCount: 0, ambiguousCount: 0, litterDeleted: false, litterArchived: false, notFound: true }
    }
    const litter = litterSnap.data()
    if (litter.tenantId !== uid) {
      throw new Error('NOT_YOUR_LITTER')
    }

    const puppyIds = litter.puppyIds || []
    const forwardSnaps = await Promise.all(puppyIds.map(id => tx.get(db.collection('dogs').doc(id))))
    const forwardFetched = forwardSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))

    // Reverse direction: any dog whose OWN litterId points here,
    // regardless of whether it was ever added to puppyIds. Single-field
    // equality where() — no composite index required.
    const reverseQuerySnap = await tx.get(db.collection('dogs').where('litterId', '==', litterId))
    const reverseFetched = reverseQuerySnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const { confirmed, reverseOnly, ambiguousCount } = resolveLitterMembership(litterId, forwardFetched, reverseFetched)
    const { eligible, preserved } = partitionConfirmedMembers(confirmed, uid)

    for (const puppy of eligible) {
      tx.delete(db.collection('dogs').doc(puppy.id))
    }

    // Codex round 6, Blocker 1: a reverse-only dog's own litterId still
    // points at this litter — even though it's never touched (deleted or
    // relinked), the LITTER document itself must survive for that
    // reference to stay resolvable. Only when NEITHER a confirmed-
    // preserved dog NOR a reverse-only dog remains linked is it safe to
    // hard-delete.
    if (preserved.length === 0 && reverseOnly.length === 0) {
      tx.delete(litterRef)
      return { deletedCount: eligible.length, preservedCount: 0, ambiguousCount, litterDeleted: true, litterArchived: false }
    }

    // At least one dog (confirmed-preserved and/or reverse-only) still
    // needs this litter document to resolve its lineage — archive
    // instead of deleting. puppyIds is recomputed to exactly the
    // confirmed-preserved set (reverse-only dogs are deliberately NOT
    // added here — round 5's "never touch ambiguous dogs" policy means
    // this operation only ever RECORDS what it can safely confirm, it
    // doesn't reconcile ambiguity on their behalf; they remain
    // discoverable via the same litterId reverse-query on any future
    // operation regardless of what puppyIds says).
    tx.update(litterRef, {
      archived: true,
      archivedAt: new Date().toISOString(),
      puppyIds: preserved.map(dog => dog.id),
    })
    return { deletedCount: eligible.length, preservedCount: preserved.length, ambiguousCount, litterDeleted: false, litterArchived: true }
  }).catch((err) => {
    if (err.message === 'NOT_YOUR_LITTER') throw new ApiError(403, 'Not your litter')
    throw err
  })

  return res.status(200).json(outcome)
}

export default withApiErrorHandling('delete-litter', handler)
