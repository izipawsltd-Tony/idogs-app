// api/create-litter-puppy.js — trusted server-side, safely-idempotent
// puppy creation for a litter (Codex round 4, Blockers 3 + 4).
//
// WHY THIS EXISTS: two round-3 designs collided under round-4 scrutiny.
// (1) createLitterPuppyAtomic() ran as a CLIENT-side Firestore
// transaction that ended with `tx.update(litterRef, { puppyIds:
// arrayUnion(dogId) })` — a direct client write to litters/{id}. (2)
// Round 4, Blocker 3 requires firestore.rules to deny ALL direct client
// litters update/delete outright (see that rule's own comment) — so (1)
// can no longer work as a client transaction. Moving puppy creation
// here, as an Admin SDK endpoint, resolves that: the litter-linking
// write bypasses Rules (as every Admin SDK write does), and Rules can
// deny the litters collection unconditionally for clients with no
// carve-out to reason about.
//
// Round 4, Blocker 4 — "an existing dogId must not automatically count
// as a valid retry": round 3's version treated `tx.get(dogRef).exists()`
// alone as proof this is a safe resume of a prior attempt. That trusts
// the CALLER's dogId with no corroborating evidence it was ever this
// same logical operation — a stale ref reused across litters, a copy-
// paste bug, or a dogId that happens to collide with an unrelated dog
// could all silently succeed (returning the unrelated dog as if it were
// the new puppy) or silently mutate the wrong litter. This endpoint
// instead persists a `litterPuppyOperations/{operationId}` record
// ATOMICALLY WITH the dog it created, and treats an existing dogId as a
// valid retry only when the operation record for the CALLER-SUPPLIED
// operationId exists AND every one of the following holds:
//   - operation.tenantId === the caller's own uid;
//   - operation.litterId === the litterId in THIS request;
//   - operation.dogId === the dogId in THIS request;
//   - operation.payload deep-matches the payload in THIS request
//     (an immutable record — the first write's payload is never
//     overwritten by a "retry" with different puppy details);
//   - the Dog document the operation points at still exists, still
//     belongs to this litter/tenant/owner;
//   - the passportReservations/{passportId} document for that Dog's own
//     passportId exists and was created by this same uid.
// Any mismatch anywhere in that chain fails the request outright with
// NO writes at all — never falls back to "create a new dog instead" and
// never silently reports success against the wrong record.
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
function payloadsMatch(a, b) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const { operationId, litterId, dogId, payload, sourceType } = body

  if (!operationId || typeof operationId !== 'string') {
    return res.status(400).json({ error: 'operationId is required' })
  }
  if (!litterId || typeof litterId !== 'string') {
    return res.status(400).json({ error: 'litterId is required' })
  }
  if (!dogId || typeof dogId !== 'string') {
    return res.status(400).json({ error: 'dogId is required' })
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload is required' })
  }
  if (payload.sex !== 'male' && payload.sex !== 'female') {
    return res.status(400).json({ error: 'payload.sex must be male or female' })
  }
  if (!parseDobStrictServer(payload.dateOfBirth)) {
    return res.status(400).json({ error: 'payload.dateOfBirth is not a valid past calendar date' })
  }
  const resolvedSourceType = sourceType === 'OWNER_CREATED' ? 'OWNER_CREATED' : 'BREEDER_ISSUED'

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)
  const litterRef = db.collection('litters').doc(litterId)
  const operationRef = db.collection('litterPuppyOperations').doc(operationId)

  try {
    for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
      const candidate = generateCandidate(payload)
      const reservationRef = db.collection('passportReservations').doc(candidate)

      try {
        const result = await db.runTransaction(async (tx) => {
          const opSnap = await tx.get(operationRef)

          if (opSnap.exists) {
            // Claimed retry of a previously-persisted operation — every
            // field of the persisted record must agree with THIS
            // request before it's trusted as a resume. Any mismatch
            // fails closed with no writes.
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
            if (!payloadsMatch(op.payload, payload)) {
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
            if (!dog.passportId) {
              return { ok: false, status: 409, body: { error: 'Existing dog has no passportId', reason: 'DOG_STATE_MISMATCH' } }
            }
            const reservationSnap = await tx.get(db.collection('passportReservations').doc(dog.passportId))
            if (!reservationSnap.exists || reservationSnap.data().createdBy !== uid) {
              return { ok: false, status: 409, body: { error: 'Passport reservation does not match this dog', reason: 'RESERVATION_MISMATCH' } }
            }

            const litterSnap = await tx.get(litterRef)
            if (litterSnap.exists && !(litterSnap.data().puppyIds || []).includes(dogId)) {
              tx.update(litterRef, { puppyIds: FieldValue.arrayUnion(dogId) })
            }
            return { ok: true, alreadyExisted: true, dogId, passportId: dog.passportId }
          }

          // No persisted operation record yet — this is either a
          // genuinely first attempt, or a retry whose first attempt
          // never got far enough to persist anything (safe to treat as
          // fresh either way, since nothing was committed).
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
          const reservationSnap = await tx.get(reservationRef)
          if (reservationSnap.exists) {
            throw new Error('PASSPORT_ID_TAKEN')
          }

          const nowIso = new Date().toISOString()
          tx.set(reservationRef, { createdAt: nowIso, createdBy: uid })
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
    return res.status(500).json({ error: 'Could not generate a unique passport ID — please try again' })
  } catch (err) {
    console.error('create-litter-puppy error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
