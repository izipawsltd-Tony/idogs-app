// Buyer Journey V1 — Enquiry -> Assign Buyer connector.
// Extracted from LittersPage.tsx (same reasoning as saleAvailabilityError.ts's
// own extraction from DogDetailPage.tsx) so both the React component AND a
// Node test script import the exact same pure decision logic, rather than a
// test mirroring it and silently drifting. Pure and side-effect-free — no
// Firestore, no React. The actual write still goes through the existing
// updateDog() in LittersPage.tsx; nothing here introduces a new data model.
import { deleteField } from 'firebase/firestore'
import type { Dog, ShowcaseEnquiry } from '../types'

// True when this puppy's current reservation already matches this
// enquiry's buyer — the idempotent-safe "nothing to do" case. Email is the
// primary match key; when neither side has an email on file, falls back to
// name so a phone-only enquiry can still register as "already assigned"
// instead of always reading as a conflict.
export function enquiryMatchesReservation(enq: ShowcaseEnquiry, puppy: Dog): boolean {
  const puppyEmail = (puppy.reservedForEmail || '').trim().toLowerCase()
  const enqEmail = (enq.email || '').trim().toLowerCase()
  if (puppyEmail || enqEmail) return !!puppyEmail && puppyEmail === enqEmail
  const puppyName = (puppy.reservedForName || '').trim().toLowerCase()
  const enqName = (enq.name || '').trim().toLowerCase()
  return !!puppyName && puppyName === enqName
}

export function hasConflictingReservation(enq: ShowcaseEnquiry, puppy: Dog): boolean {
  const reservedLike = puppy.availabilityStatus === 'reserved' || puppy.availabilityStatus === 'sold'
  return reservedLike && !enquiryMatchesReservation(enq, puppy)
}

// Staging QA finding (Buyer Journey V1 fast-follow): the conflict-overwrite
// confirm() must never say "reserved" for a puppy that's actually SOLD — a
// breeder could read that as overwriting a soft hold, when accepting also
// silently downgrades availabilityStatus from 'sold' back to 'reserved'.
// Only called when hasConflictingReservation() is already true, so a
// current buyer always exists on the sold/reserved puppy.
export function buildAssignBuyerConfirmMessage(enq: ShowcaseEnquiry, puppy: Dog): string {
  const currentBuyer = puppy.reservedForName || puppy.reservedForEmail || 'another buyer'
  if (puppy.availabilityStatus === 'sold') {
    return `${puppy.name} is currently SOLD to ${currentBuyer}.\n\nReassign buyer to ${enq.name}?\n\nThis will change ${puppy.name}'s status from SOLD to RESERVED and replace the current buyer.`
  }
  return `${puppy.name} is already reserved for ${currentBuyer}. Reassign to ${enq.name}?`
}

// Same reservedAt derivation SaleAvailabilityPanel already uses
// (DogDetailPage.tsx: new Date().toISOString().split('T')[0]) — no new
// timestamp format. reservedForEmail/reservedForPhone are ALWAYS present on
// the returned object (explicitly `undefined` when the enquiry doesn't have
// one) — never omitted. This is deliberate: staging QA found that omitting
// the key on a reassignment left a PREVIOUS buyer's phone/email attached to
// the new buyer whenever the new enquiry simply didn't supply one. Callers
// must run this through toFirestoreAssignBuyerUpdate() before writing —
// this object itself is safe to spread into local React state (an
// explicit `undefined` reads identically to "unset" everywhere it's
// consumed) but is NOT Firestore-write-safe on its own (updateDoc()
// rejects a literal `undefined` field value).
export function buildAssignBuyerUpdate(enq: ShowcaseEnquiry, now: Date = new Date()): Partial<Dog> {
  return {
    availabilityStatus: 'reserved',
    reservedForName: enq.name.trim(),
    reservedForEmail: enq.email && enq.email.trim() ? enq.email.trim() : undefined,
    reservedForPhone: enq.phone && enq.phone.trim() ? enq.phone.trim() : undefined,
    reservedAt: now.toISOString().split('T')[0],
  }
}

// Firestore-write counterpart to buildAssignBuyerUpdate()'s local-state
// object: every `undefined` value becomes an explicit deleteField()
// sentinel, mirroring SaleAvailabilityPanel's own orDelete() convention in
// DogDetailPage.tsx (the same established pattern this connector was
// already told to mirror) — so a reassignment to a buyer with no phone/
// email genuinely CLEARS the previous buyer's stale value in Firestore,
// rather than silently leaving it untouched because the key was never
// present in the update payload. Return type matches SaleAvailabilityPanel's
// own `firestoreUpdates: any` — a FieldValue sentinel is not assignable to
// Dog's plain string fields, and this is a write-shape helper, not a Dog.
export function toFirestoreAssignBuyerUpdate(updates: Partial<Dog>): any {
  return {
    availabilityStatus: updates.availabilityStatus,
    reservedForName: updates.reservedForName,
    reservedForEmail: updates.reservedForEmail === undefined ? deleteField() : updates.reservedForEmail,
    reservedForPhone: updates.reservedForPhone === undefined ? deleteField() : updates.reservedForPhone,
    reservedAt: updates.reservedAt,
  }
}
