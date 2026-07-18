// api/create-litter.js — trusted server-side litter creation (Codex
// round 3, Blocker 1; hardened Codex round 4, Blocker 1; hardened Codex
// round 5, Blocker 6).
//
// WHY THIS EXISTS: firestore.rules can verify a Sire/Dam reference's
// ownership/sex/deceased/DOB-format, but has no date-arithmetic
// functions to compute an age from a DOB string — so "meets actual
// minimum breeding maturity" can't be enforced there. Per the explicit
// instruction to move any mutation Rules can't fully validate to a
// trusted server endpoint, litter creation now happens here: the Dam
// (and Sire, if an in-account dog was selected) are re-read fresh from
// Firestore via the Admin SDK and validated against the single canonical
// policy in _lib/parent-eligibility.js, never trusting anything the
// client submitted about them. firestore.rules denies direct client
// writes to litters/{id} create entirely — this endpoint is now the
// only path.
//
// Codex round 4, Blocker 1: the Dam/Sire reads and the litter write now
// happen inside ONE db.runTransaction — see that round's own note on why
// a plain get()-then-set() sequence has a stale-read race window a
// transaction closes.
//
// Codex round 5, Blocker 6: name/sireName/notes/dates are now validated
// through api/_lib/litter-schema.js — an explicit field allowlist
// (unknown keys rejected outright) plus real calendar-date and length
// checks, rather than the previous `field || ''` fallbacks that accepted
// any string (including an impossible or future-dated actualBirthDate)
// as long as the client's own UI happened not to send one.
//
// POST /api/create-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { name?, damId, sireId?, sireName?, matingSuspectedDate?,
//         expectedDueDate?, actualBirthDate?, notes? }
// Returns: { litterId } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { validateBreedingParent } from './_lib/parent-eligibility.js'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { sanitizeLitterInput, LitterValidationError, CREATE_FIELDS } from './_lib/litter-schema.js'

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
  const { damId, sireId, ...rest } = body

  if (!damId || typeof damId !== 'string') {
    throw new ApiError(400, 'damId is required')
  }
  if (sireId !== undefined && typeof sireId !== 'string') {
    throw new ApiError(400, 'sireId must be a string')
  }

  let safeFields
  try {
    safeFields = sanitizeLitterInput(rest, CREATE_FIELDS)
  } catch (err) {
    if (err instanceof LitterValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const useInAccountSire = sireId && sireId !== '__external__'

  const db = getFirestore()
  const damRef = db.collection('dogs').doc(damId)
  const sireRef = useInAccountSire ? db.collection('dogs').doc(sireId) : null
  const litterRef = db.collection('litters').doc()

  const result = await db.runTransaction(async (tx) => {
    // Reads must precede writes in a transaction — both parent reads
    // happen first, then validation, then (only if both pass) the
    // single write. If either read's document changes before this
    // transaction commits, Firestore retries this whole callback
    // against the fresh state rather than committing against data
    // that was true a moment ago but no longer is.
    const damSnap = await tx.get(damRef)
    const sireSnap = sireRef ? await tx.get(sireRef) : null

    const damCheck = validateBreedingParent(damSnap.exists ? damSnap.data() : null, { uid, requiredSex: 'female' })
    if (!damCheck.valid) {
      return { ok: false, status: 400, body: { error: 'Dam is not an eligible breeding parent', reason: damCheck.reason } }
    }
    if (sireRef) {
      const sireCheck = validateBreedingParent(sireSnap.exists ? sireSnap.data() : null, { uid, requiredSex: 'male' })
      if (!sireCheck.valid) {
        return { ok: false, status: 400, body: { error: 'Sire is not an eligible breeding parent', reason: sireCheck.reason } }
      }
    }

    const dam = damSnap.data()
    tx.set(litterRef, {
      tenantId: uid,
      name: safeFields.name?.trim() || `${dam.name} Litter`,
      damId,
      sireId: useInAccountSire ? sireId : null,
      sireName: sireId === '__external__' ? (safeFields.sireName?.trim() || null) : null,
      matingSuspectedDate: safeFields.matingSuspectedDate || '',
      expectedDueDate: safeFields.expectedDueDate || '',
      actualBirthDate: safeFields.actualBirthDate || '',
      notes: safeFields.notes || '',
      puppyIds: [],
      createdAt: new Date().toISOString(),
    })
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ litterId: litterRef.id })
}

export default withApiErrorHandling('create-litter', handler)
