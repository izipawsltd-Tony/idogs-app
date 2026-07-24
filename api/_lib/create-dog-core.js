// api/_lib/create-dog-core.js — the atomic passportId-reservation +
// dog-write transaction, factored out of api/create-dog.js so its
// collision/retry behavior is directly testable (Codex Medium item:
// "replace structural/source-order assertions with behavioural retry,
// failure and concurrency tests" — same DI pattern already used for
// api/_lib/scan-quota.js). `generateCandidateFn` defaults to the real
// nanoid-based generator but is injectable for deterministic tests.

export const MAX_PASSPORT_ID_ATTEMPTS = 5
const NANOID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function nanoidServer(len = 4) {
  let result = ''
  for (let i = 0; i < len; i++) result += NANOID_CHARS[Math.floor(Math.random() * NANOID_CHARS.length)]
  return result
}

export function generateCandidate(name, dateOfBirth) {
  const now = new Date()
  const yearPart = dateOfBirth ? String(dateOfBirth).slice(0, 4) : String(now.getFullYear())
  const namePart = String(name || 'DOG').slice(0, 3).toUpperCase()
  return `${namePart}-${yearPart}-${nanoidServer(4)}`
}

// Attempts the atomic reservation+write up to MAX_PASSPORT_ID_ATTEMPTS
// times, retrying only on a genuine reservation collision (any other
// thrown error propagates immediately, aborting the whole create).
// `buildDogData(tx, candidate)` runs INSIDE the transaction, after the
// reservation-collision check but before either write — it does the
// caller's own reads (e.g. the cap-aware status read in create-dog.js)
// and returns the full dog document to write.
export async function createDogWithRetry({ db, dogRef, reservationCreatedBy, name, dateOfBirth, buildDogData, generateCandidateFn = generateCandidate }) {
  for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
    const candidate = generateCandidateFn(name, dateOfBirth)
    const reservationRef = db.collection('passportReservations').doc(candidate)
    try {
      return await db.runTransaction(async tx => {
        const reservationSnap = await tx.get(reservationRef)
        if (reservationSnap.exists) {
          throw new Error('PASSPORT_ID_TAKEN')
        }
        const dogData = await buildDogData(tx, candidate)
        const nowIso = new Date().toISOString()
        tx.set(reservationRef, { createdAt: nowIso, createdBy: reservationCreatedBy, dogId: dogRef.id })
        tx.set(dogRef, dogData)
        return { ok: true, dogId: dogRef.id, passportId: candidate, status: dogData.status }
      })
    } catch (err) {
      if (err.message !== 'PASSPORT_ID_TAKEN') throw err
      // else: genuine collision on this specific candidate — the WHOLE
      // transaction rolled back, nothing committed. Loop and try a fresh
      // candidate; dogRef itself is untouched and safe to reuse.
    }
  }
  throw new Error('Could not generate a unique passport ID — please try again')
}
