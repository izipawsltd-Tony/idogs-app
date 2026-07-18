// api/_lib/parent-eligibility.js — the ONE canonical Dam/Sire breeding-
// parent eligibility policy (Codex round 3, Blocker 1).
//
// Firestore Rules can enforce ownership/sex/deceased/DOB-*format* checks
// (see isEligibleBreedingDog in firestore.rules) but has no generic date
// arithmetic to compute an age from a DOB string, so "meets actual
// minimum breeding maturity" and "not future-dated" (beyond simple
// string-format validity) cannot be safely enforced there. This module
// is the trusted, server-side equivalent — imported by every API route
// that creates or updates a record referencing a Dam or Sire — so the
// full policy is defined exactly once and can never drift between the
// litter-creation and heat-cycle endpoints.
//
// A dog is eligible as a breeding parent for `uid` + `requiredSex` only
// if ALL of:
//   - it exists;
//   - currentOwnerId === uid (exact, current breeder control — not
//     tenantId, which is permanent provenance but not an ongoing right);
//   - sex === requiredSex;
//   - not deceased;
//   - not transferred / not pending-claim (covers both the current
//     transferStatus marking and the legacy status-only marking);
//   - dateOfBirth is present, a real YYYY-MM-DD calendar date (not
//     silently rolled over by a lenient parser), and not future-dated;
//   - at least MIN_BREEDING_MONTHS old (the floor across every state in
//     src/lib/breedingCompliance.ts's STATE_RULES — all 8 AU states/
//     territories currently set minBreedingMonths to 12; large-breed
//     state-specific extensions to 18 months are a client-side display
//     refinement, not enforced here, since that needs breed
//     classification this endpoint doesn't otherwise need).
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

export function ageInMonths(birth, now = new Date()) {
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
}

// dogData: the plain object from an Admin SDK dogSnap.data() (or null if
// the referenced document doesn't exist). Never trusts anything from the
// request body — always re-reads the CURRENT Dog document server-side.
export function validateBreedingParent(dogData, { uid, requiredSex }) {
  if (!dogData) return { valid: false, reason: 'PARENT_NOT_FOUND' }
  if (dogData.currentOwnerId !== uid) return { valid: false, reason: 'PARENT_NOT_CONTROLLED' }
  if (dogData.sex !== requiredSex) return { valid: false, reason: 'PARENT_WRONG_SEX' }
  if (dogData.isDeceased) return { valid: false, reason: 'PARENT_DECEASED' }
  if (dogData.status === 'transferred' || dogData.transferStatus === 'pendingClaim') {
    return { valid: false, reason: 'PARENT_TRANSFERRED' }
  }
  const birth = parseDobStrictServer(dogData.dateOfBirth)
  if (!birth) return { valid: false, reason: 'PARENT_INVALID_DOB' }
  if (ageInMonths(birth) < MIN_BREEDING_MONTHS) return { valid: false, reason: 'PARENT_UNDERAGE' }
  return { valid: true }
}
