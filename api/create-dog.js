// api/create-dog.js — trusted server-side dog creation (Codex H2).
//
// WHY THIS EXISTS: dog creation used to be a pure CLIENT-side Firestore
// transaction (createDog() in src/lib/db.ts), gated only by
// firestore.rules' `dogs/{dogId}` create rule — which checks ownership
// fields and dateOfBirth format, but has NO way to count how many dogs
// this uid already has active (Firestore Rules has no cross-document
// aggregate-count primitive). That meant a client (a modified app build,
// or a direct Firestore SDK call from devtools — nothing enforced going
// through the app's own UI at all) could create unlimited 'active' dogs,
// completely bypassing the Free=2/Plus=5 cap. The app's own
// reconcileDogCapBestEffort() follow-up call (still present, now
// redundant for this path) was exactly that — best-effort, not
// enforcement; a caller could simply never make that second request.
//
// This endpoint is the fix: `firestore.rules` now denies ALL direct
// client `dogs/{dogId}` create (`if false`, mirroring the same pattern
// already used for litters/heat-cycles/puppies), and every dog creation
// goes through here instead — the SAME atomic passport-reservation +
// dog-write transaction createDog() used to run client-side, but now
// with a cap-aware status decision computed from a live count taken
// INSIDE that same transaction. Never blocks creation: a dog created
// beyond the caller's current cap simply lands 'restricted' instead of
// 'active' — the same "never block, just restrict" design as every other
// part of this pricing model (§3.2/§3.3/§4.4).
//
// POST /api/create-dog
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { data: DogFormData, sourceType?: 'BREEDER_ISSUED' | 'OWNER_CREATED' }
// Returns: { dogId, passportId, status } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { isValidCalendarDateString } from './_lib/date-utils.js'
import { parseDobStrictServer, ageInMonths } from './_lib/parent-eligibility.js'
import { capForPlan, getOwnedActiveDogsSorted } from './_lib/dog-cap.js'
import { computeEffectivePlan } from './_lib/entitlements.js'
import { createDogWithRetry } from './_lib/create-dog-core.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// A safe INITIAL life stage only — syncLifeStage() (src/lib/db.ts)
// re-derives the true breed-aware value the first time the dog's own
// detail page loads and self-corrects via an audited update. Mirrors
// api/create-litter-puppy.js's identical initialLifeStage() exactly.
function initialLifeStage(dateOfBirth) {
  const birth = parseDobStrictServer(dateOfBirth)
  if (!birth) return 'puppy'
  const months = ageInMonths(birth)
  if (months < 2) return 'whelp'
  if (months < 12) return 'puppy'
  if (months < 24) return 'young_adult'
  if (months < 108) return 'adult'
  return 'senior'
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
  const data = body.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(400, 'data is required')
  }
  if (typeof data.name !== 'string' || typeof data.breed !== 'string' || typeof data.sex !== 'string') {
    throw new ApiError(400, 'name, breed, and sex are required strings')
  }
  // Same format-only check firestore.rules' isValidDobString previously
  // enforced on direct client create — future/implausible-age rejection
  // stays a client-layer concern, unchanged from before.
  if (!isValidCalendarDateString(data.dateOfBirth)) {
    throw new ApiError(400, 'dateOfBirth must be a valid YYYY-MM-DD calendar date')
  }
  const sourceType = body.sourceType === 'OWNER_CREATED' ? 'OWNER_CREATED' : 'BREEDER_ISSUED'

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc()
  const userRef = db.collection('users').doc(uid)
  const nowIso = new Date().toISOString()

  async function buildDogData(tx, candidate) {
    const userSnap = await tx.get(userRef)
    const profile = userSnap.exists ? userSnap.data() : {}
    const plan = computeEffectivePlan(profile)
    const cap = capForPlan(plan)
    const activeDogs = await getOwnedActiveDogsSorted(tx, db, uid)
    // Codex H2 — the cap decision is made from a count taken INSIDE
    // this same transaction, atomically with the reservation check
    // and the writes below. Never blocks creation (§3.2/§4.4 "never
    // block, just restrict") — a dog created beyond the cap simply
    // lands 'restricted' instead of 'active'.
    const status = activeDogs.length >= cap ? 'restricted' : 'active'
    // Codex fix-round (Finding 3): tag WHY this dog landed 'restricted' —
    // see api/_lib/dog-cap.js's header comment. Lets future reconciliation
    // prove this was cap-driven instead of guessing from shape alone.
    return {
      name: data.name,
      breed: data.breed,
      sex: data.sex,
      dateOfBirth: data.dateOfBirth,
      colour: data.colour || '',
      microchip: data.microchip || '',
      ankc: data.ankc || '',
      notes: data.notes || '',
      ...(typeof data.pedigreeRegister === 'string' ? { pedigreeRegister: data.pedigreeRegister } : {}),
      ...(typeof data.breederIdType === 'string' ? { breederIdType: data.breederIdType } : {}),
      ...(typeof data.breederIdValue === 'string' ? { breederIdValue: data.breederIdValue } : {}),
      tenantId: uid,
      currentOwnerId: uid,
      createdByUserId: uid,
      sourceType,
      ...(sourceType === 'BREEDER_ISSUED' ? { originBreederId: uid } : {}),
      passportId: candidate,
      lifeStage: initialLifeStage(data.dateOfBirth),
      isDeceased: false,
      photos: [],
      status,
      ...(status === 'restricted' ? { restrictionReason: 'plan_cap_exceeded' } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    }
  }

  try {
    const result = await createDogWithRetry({
      db, dogRef, reservationCreatedBy: uid,
      name: data.name, dateOfBirth: data.dateOfBirth,
      buildDogData,
    })
    return res.status(200).json(result)
  } catch (err) {
    // Only the retry-exhaustion outcome is a client-safe, expected error —
    // anything else (a genuine unexpected failure inside the transaction)
    // must propagate untouched to withApiErrorHandling's own catch-all,
    // which sanitizes it to a generic 500 without echoing err.message.
    if (err.message === 'Could not generate a unique passport ID — please try again') {
      throw new ApiError(500, err.message)
    }
    throw err
  }
}

export default withApiErrorHandling('create-dog', handler)
