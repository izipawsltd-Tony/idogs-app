// api/_lib/parent-eligibility.js — the ONE canonical Dam/Sire breeding-
// parent eligibility policy (Codex round 3, Blocker 1; hardened Codex
// round 4, Blockers 1 + 2).
//
// Firestore Rules can enforce ownership/sex/deceased/DOB-*format* checks
// (see isEligibleBreedingDog in firestore.rules) but has no generic date
// arithmetic to compute an age from a DOB string, so "meets actual
// minimum breeding maturity" and "not future-dated" (beyond simple
// string-format validity) cannot be safely enforced there. This module
// is the trusted, server-side equivalent — imported by every API route
// that creates or updates a record referencing a Dam or Sire — so the
// full policy is defined exactly once and can never drift between the
// litter-creation and heat-cycle endpoints. Every caller must re-read
// the Dog document INSIDE the same Admin SDK transaction that performs
// the write this validates (see create-litter.js / save-heat-cycle.js /
// create-litter-puppy.js) — a read taken before the transaction started
// is stale the moment a concurrent transfer/claim/deceased-marking
// happens, and Admin SDK writes bypass Firestore Rules entirely, so this
// module is the ONLY enforcement point; nothing else catches a stale read.
//
// A dog is eligible as a breeding parent for `uid` + `requiredSex` only
// if ALL of:
//   - it exists;
//   - currentOwnerId === uid (exact, current breeder control — not
//     tenantId, which is permanent provenance but not an ongoing right);
//   - sex === requiredSex;
//   - not deceased;
//   - status === 'active', EXACTLY (Codex round 4, Blocker 1) — missing,
//     empty, 'archived', 'deleted', 'transferred', or any other value
//     all fail closed. This subsumes (and is stricter than) round 3's
//     "not transferred" check: a transferred dog's status is always
//     'transferred', never 'active', so it's caught here too. The old
//     transferStatus check is kept as an explicit second signal — a
//     'pendingClaim' dog whose status field somehow lagged behind (a
//     legacy/partial write) must still fail, not slip through on a
//     stale-but-technically-'active' status alone;
//   - transferStatus is not 'pendingClaim';
//   - dateOfBirth is present, a real YYYY-MM-DD calendar date (not
//     silently rolled over by a lenient parser), and not future-dated;
//   - at least MIN_BREEDING_MONTHS old, computed as a true calendar age
//     (year, month, AND day — see ageInMonths below) — the floor across
//     every state in src/lib/breedingCompliance.ts's STATE_RULES (all 8
//     AU states/territories currently set minBreedingMonths to 12;
//     large-breed state-specific extensions to 18 months are a
//     client-side display refinement, not enforced here, since that
//     needs breed classification this endpoint doesn't otherwise need).
//
// Anything malformed, missing, or ambiguous fails CLOSED (not eligible)
// — never defaults to "assume eligible".

export const MIN_BREEDING_MONTHS = 12

// Mirrors lib/utils.ts's parseDobStrict exactly (calendar-component
// comparison, never an absolute-instant comparison — see that file's
// own comment on why: mixing UTC/local timezone semantics between
// construction and comparison is exactly what caused a real,
// environment-dependent test failure in an earlier round).
export function parseDobStrictServer(dob) {
  if (typeof dob !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  const today = new Date()
  const isFuture = year > today.getFullYear() ||
    (year === today.getFullYear() && month - 1 > today.getMonth()) ||
    (year === today.getFullYear() && month - 1 === today.getMonth() && day > today.getDate())
  if (isFuture) return null
  return parsed
}

// Whole calendar months elapsed from `birth` to `now`, accounting for
// day-of-month — not just year/month. Codex round 4, Blocker 2: the
// previous version computed (now.year - birth.year)*12 +
// (now.month - birth.month) alone, which counts "31 Jul 2025 -> 1 Jul
// 2026" as a full 12 months (wrong — that's 11 months, one day short of
// the birthday) purely because the month numbers happen to match. The
// day-of-month comparison below corrects this: if `now`'s day-of-month
// hasn't yet reached `birth`'s day-of-month, the most recent month
// boundary hasn't actually been crossed, so it's subtracted back out.
//
// Deterministic for month-end/leap-day edges by construction (JS Date's
// own day-of-month arithmetic, never re-derived): a birth of 29 Feb in a
// leap year has no 29 Feb in a non-leap `now` year, so `now.getDate()`
// can be at most 28 that month — always less than birth's 29 — so that
// month never counts as crossed until `now` rolls into March, landing
// the "birthday" deterministically on 1 Mar in a non-leap year. Same
// logic applies to any birth on the 29th/30th/31st against a shorter
// `now` month.
//
// Calendar-date components only (getFullYear/getMonth/getDate) — never
// an absolute-instant comparison — so this is timezone-safe the same
// way parseDobStrictServer's future-date check is: both `birth` and
// `now` are plain local-timezone Date objects built from Y/M/D
// components, never compared via getTime()/epoch math.
export function ageInMonths(birth, now = new Date()) {
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  return months
}

// dogData: the plain object read INSIDE the caller's own Admin SDK
// transaction (never a read taken before the transaction started, and
// never anything from the request body) — the whole point of doing this
// inside a transaction is that Firestore's optimistic-concurrency
// commit check re-validates the read is still fresh at commit time, so a
// concurrent ownership/status/transfer/claim/deceased/DOB change either
// gets caught by the transaction retrying this validation against the
// new state, or (if the transaction has already moved past the read) by
// Firestore rejecting the commit outright. A plain dogSnap.get() outside
// a transaction has neither guarantee — see create-litter.js /
// save-heat-cycle.js / create-litter-puppy.js for the transaction
// wiring; this function itself is pure and stateless.
export function validateBreedingParent(dogData, { uid, requiredSex }) {
  if (!dogData) return { valid: false, reason: 'PARENT_NOT_FOUND' }
  if (dogData.currentOwnerId !== uid) return { valid: false, reason: 'PARENT_NOT_CONTROLLED' }
  if (dogData.sex !== requiredSex) return { valid: false, reason: 'PARENT_WRONG_SEX' }
  if (dogData.isDeceased) return { valid: false, reason: 'PARENT_DECEASED' }
  if (dogData.status !== 'active') return { valid: false, reason: 'PARENT_NOT_ACTIVE' }
  if (dogData.transferStatus === 'pendingClaim') {
    return { valid: false, reason: 'PARENT_TRANSFERRED' }
  }
  const birth = parseDobStrictServer(dogData.dateOfBirth)
  if (!birth) return { valid: false, reason: 'PARENT_INVALID_DOB' }
  if (ageInMonths(birth) < MIN_BREEDING_MONTHS) return { valid: false, reason: 'PARENT_UNDERAGE' }
  return { valid: true }
}
