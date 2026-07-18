// api/create-litter-puppy.js — trusted server-side, safely-idempotent
// puppy creation for a litter (Codex round 4, Blockers 3 + 4; hardened
// Codex round 5, Blocker 4).
//
// WHY THIS EXISTS: two round-3 designs collided under round-4 scrutiny.
// (1) createLitterPuppyAtomic() ran as a CLIENT-side Firestore
// transaction that ended with `tx.update(litterRef, { puppyIds:
// arrayUnion(dogId) })` — a direct client write to litters/{id}. (2)
// Round 4, Blocker 3 requires firestore.rules to deny ALL direct client
// litters update/delete outright — so (1) can no longer work as a
// client transaction. Moving puppy creation here, as an Admin SDK
// endpoint, resolves that.
//
// Round 4, Blocker 4 — "an existing dogId must not automatically count
// as a valid retry": this endpoint persists a
// `litterPuppyOperations/{operationId}` record ATOMICALLY WITH the dog
// it created, and treats an existing dogId as a valid retry only when
// the operation record for the CALLER-SUPPLIED operationId exists AND
// every field of it agrees with THIS request.
//
// Codex round 5, Blocker 4 — two further gaps in "every field agrees":
//
// 1. Round 4 only compared the PERSISTED OPERATION RECORD's payload
//    against the new request's payload — it never re-read the actual
//    Dog document's CURRENT field values and compared those too. If
//    the Dog were somehow modified after creation (e.g. an unrelated
//    updateDog() call changed its name before the retry arrived), the
//    retry would still report alreadyExisted:true and return the
//    (silently divergent) dog, treating a "same operationId" match as
//    proof the Dog itself is still exactly what this operation created.
//    It isn't automatically — they're two different documents that
//    happen to be linked by id. This endpoint now ALSO compares the
//    Dog's own stored fields (name, breed, sex, dateOfBirth, colour,
//    microchip, ankc, notes, sourceType) against the operation record,
//    failing DOG_FIELDS_MISMATCH if anything has drifted.
//
// 2. The Passport reservation was only ever bound to `createdBy` (the
//    uid) — any reservation created by the same user, for ANY dog or
//    operation, would satisfy that check. It's now bound to the exact
//    dogId AND operationId at creation time, and a retry verifies both,
//    not just the uid — a reservation "substituted" from a different
//    (same-user) operation now fails RESERVATION_MISMATCH instead of
//    silently passing.
//
// Any mismatch anywhere in this chain fails the request outright with
// NO writes at all.
//
// POST /api/create-litter-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { operationId, litterId, dogId, payload: { name, breed, sex,
//         dateOfBirth, colour, microchip, ankc, notes }, sourceType? }
// Returns: { dogId, passportId, alreadyExisted } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { parseDobStrictServer, ageInMonths } from './_lib/parent-eligibility.js'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const MAX_PASSPORT_ID_ATTEMPTS = 5
const NANOID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAYLOAD_FIELDS = ['name', 'breed', 'sex', 'dateOfBirth', 'colour', 'microchip', 'ankc', 'notes']

function nanoidServer(len = 4) {
  let result = ''
  for (let i = 0; i < len; i++) result += NANOID_CHARS[Math.floor(Math.random() * NANOID_CHARS.length)]
  return result
}

function generateCandidate(payload) {
  const now = new Date()
  const yearPart = payload.dateOfBirth ? String(payload.dateOfBirth).slice(0, 4) : String(now.getFullYear())
  const namePart = String(payload.name || 'DOG').slice(0, 3).toUpperCase()
  return `${namePart}-${yearPart}-${nanoidServer(4)}`
}

// Field-by-field, not a hash — the payload is small and this keeps the
// comparison legible and immune to any hash-collision concern entirely.
// Used both for request-payload-vs-operation-record AND (Codex round 5)
// operation-record-vs-actual-Dog-document comparisons — both sides are
// plain objects with the same field names, so one function serves both.
function fieldsMatch(a, b) {
  if (!a || !b) return false
  return PAYLOAD_FIELDS.every(f => String(a[f] ?? '') === String(b[f] ?? ''))
}

// A safe INITIAL life stage only — syncLifeStage() (src/lib/db.ts)
// re-derives the true breed-aware value the first time the puppy's own
// detail page loads and self-corrects via an audited update, so this
// doesn't need breed-size brackets, just a reasonable starting value.
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
  const { operationId, litterId, dogId, payload, sourceType } = body

  if (!operationId || typeof operationId !== 'string') {
    throw new ApiError(400, 'operationId is required')
  }
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (!dogId || typeof dogId !== 'string') {
    throw new ApiError(400, 'dogId is required')
  }
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(400, 'payload is required')
  }
  if (payload.sex !== 'male' && payload.sex !== 'female') {
    throw new ApiError(400, 'payload.sex must be male or female')
  }
  if (!parseDobStrictServer(payload.dateOfBirth)) {
    throw new ApiError(400, 'payload.dateOfBirth is not a valid past calendar date')
  }
  const resolvedSourceType = sourceType === 'OWNER_CREATED' ? 'OWNER_CREATED' : 'BREEDER_ISSUED'

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)
  const litterRef = db.collection('litters').doc(litterId)
  const operationRef = db.collection('litterPuppyOperations').doc(operationId)

  for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
    const candidate = generateCandidate(payload)
    const reservationRef = db.collection('passportReservations').doc(candidate)

    try {
      const result = await db.runTransaction(async (tx) => {
        const opSnap = await tx.get(operationRef)

        if (opSnap.exists) {
          // Claimed retry of a previously-persisted operation — every
          // field of the persisted record must agree with THIS request
          // before it's trusted as a resume. Any mismatch fails closed
          // with no writes.
          const op = opSnap.data()
          if (op.tenantId !== uid) {
            return { ok: false, status: 403, body: { error: 'Operation belongs to a different account', reason: 'OPERATION_TENANT_MISMATCH' } }
          }
          if (op.litterId !== litterId) {
            return { ok: false, status: 409, body: { error: 'Operation is for a different litter', reason: 'OPERATION_LITTER_MISMATCH' } }
          }
          if (op.dogId !== dogId) {
            return { ok: false, status: 409, body: { error: 'Operation is for a different dog id', reason: 'OPERATION_DOG_MISMATCH' } }
          }
          if (op.sourceType !== resolvedSourceType) {
            return { ok: false, status: 409, body: { error: 'Operation source type does not match', reason: 'OPERATION_SOURCE_MISMATCH' } }
          }
          if (!fieldsMatch(op.payload, payload)) {
            return { ok: false, status: 409, body: { error: 'Operation payload does not match the original submission', reason: 'OPERATION_PAYLOAD_MISMATCH' } }
          }

          const dogSnap = await tx.get(dogRef)
          if (!dogSnap.exists) {
            return { ok: false, status: 409, body: { error: 'The dog this operation created no longer exists', reason: 'DOG_MISSING' } }
          }
          const dog = dogSnap.data()
          if (dog.litterId !== litterId || dog.tenantId !== uid || dog.currentOwnerId !== uid) {
            return { ok: false, status: 409, body: { error: 'Existing dog state no longer matches this operation', reason: 'DOG_STATE_MISMATCH' } }
          }
          // Codex round 5, Blocker 4: the operation record matching the
          // REQUEST is not proof the DOG DOCUMENT itself still matches —
          // it could have been modified independently after creation.
          // Compare the Dog's own current fields against the operation's
          // immutable creation payload directly.
          if (dog.sourceType !== op.sourceType || !fieldsMatch(dog, op.payload)) {
            return { ok: false, status: 409, body: { error: 'The existing dog\'s fields no longer match its original creation payload', reason: 'DOG_FIELDS_MISMATCH' } }
          }
          if (!dog.passportId) {
            return { ok: false, status: 409, body: { error: 'Existing dog has no passportId', reason: 'DOG_STATE_MISMATCH' } }
          }
          const reservationSnap = await tx.get(db.collection('passportReservations').doc(dog.passportId))
          if (!reservationSnap.exists) {
            return { ok: false, status: 409, body: { error: 'Passport reservation does not match this dog', reason: 'RESERVATION_MISMATCH' } }
          }
          const reservation = reservationSnap.data()
          // Codex round 5, Blocker 4: bound to dogId + operationId, not
          // just createdBy — a reservation created by the same user for
          // a DIFFERENT dog/operation must never be accepted as a match
          // just because the uid happens to line up.
          if (reservation.createdBy !== uid || reservation.dogId !== dogId || reservation.operationId !== operationId) {
            return { ok: false, status: 409, body: { error: 'Passport reservation does not match this dog', reason: 'RESERVATION_MISMATCH' } }
          }

          const litterSnap = await tx.get(litterRef)
          if (litterSnap.exists && !(litterSnap.data().puppyIds || []).includes(dogId)) {
            tx.update(litterRef, { puppyIds: FieldValue.arrayUnion(dogId) })
          }
          return { ok: true, alreadyExisted: true, dogId, passportId: dog.passportId }
        }

        // No persisted operation record yet — this is either a
        // genuinely first attempt, or a retry whose first attempt never
        // got far enough to persist anything (safe to treat as fresh
        // either way, since nothing was committed).
        const dogSnap = await tx.get(dogRef)
        if (dogSnap.exists) {
          // dogId already exists but with NO corroborating operation
          // record — never silently reused. Round 4, Blocker 4: an
          // existing dogId alone is not proof of a valid retry.
          return { ok: false, status: 409, body: { error: 'A dog with this id already exists for a different operation', reason: 'DOG_ID_COLLISION' } }
        }
        const litterSnap = await tx.get(litterRef)
        if (!litterSnap.exists) {
          return { ok: false, status: 404, body: { error: 'Litter not found' } }
        }
        const litter = litterSnap.data()
        if (litter.tenantId !== uid) {
          return { ok: false, status: 403, body: { error: 'Not your litter' } }
        }
        if (litter.archived) {
          return { ok: false, status: 409, body: { error: 'This litter has been deleted and can no longer accept puppies', reason: 'LITTER_ARCHIVED' } }
        }
        const reservationSnap = await tx.get(reservationRef)
        if (reservationSnap.exists) {
          throw new Error('PASSPORT_ID_TAKEN')
        }

        const nowIso = new Date().toISOString()
        // Codex round 5, Blocker 4: bind this reservation to the exact
        // dogId + operationId, not just createdBy.
        tx.set(reservationRef, { createdAt: nowIso, createdBy: uid, dogId, operationId })
        tx.set(dogRef, {
          name: payload.name || '',
          breed: payload.breed || '',
          sex: payload.sex,
          dateOfBirth: payload.dateOfBirth,
          colour: payload.colour || '',
          microchip: payload.microchip || '',
          ankc: payload.ankc || '',
          notes: payload.notes || '',
          tenantId: uid,
          currentOwnerId: uid,
          createdByUserId: uid,
          sourceType: resolvedSourceType,
          ...(resolvedSourceType === 'BREEDER_ISSUED' ? { originBreederId: uid } : {}),
          passportId: candidate,
          litterId,
          lifeStage: initialLifeStage(payload.dateOfBirth),
          isDeceased: false,
          photos: [],
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        tx.set(operationRef, {
          tenantId: uid,
          litterId,
          dogId,
          sourceType: resolvedSourceType,
          payload: PAYLOAD_FIELDS.reduce((acc, f) => ({ ...acc, [f]: payload[f] ?? '' }), {}),
          status: 'completed',
          createdAt: nowIso,
        })
        tx.update(litterRef, { puppyIds: FieldValue.arrayUnion(dogId) })
        return { ok: true, alreadyExisted: false, dogId, passportId: candidate }
      })

      if (!result.ok) {
        return res.status(result.status).json(result.body)
      }
      return res.status(200).json({ dogId: result.dogId, passportId: result.passportId, alreadyExisted: result.alreadyExisted })
    } catch (err) {
      if (err.message !== 'PASSPORT_ID_TAKEN') throw err
      // else: genuine collision on this specific candidate — loop and
      // try a fresh one. Safe to regenerate: nothing from this failed
      // attempt was persisted (the whole transaction rolled back).
    }
  }
  throw new ApiError(500, 'Could not generate a unique passport ID — please try again')
}

export default withApiErrorHandling('create-litter-puppy', handler)
