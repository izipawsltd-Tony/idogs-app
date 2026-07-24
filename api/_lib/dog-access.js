// api/_lib/dog-access.js — centralized server-side (Admin SDK) mutation
// authorization for a dog document and its dogId-keyed sub-records
// (vaccineRecords/wormingRecords/healthTests/activityNotes/documents/
// profilePhoto). Codex H8 (round 2).
//
// WHY THIS EXISTS: Admin SDK endpoints bypass firestore.rules entirely,
// so each one has always needed its OWN authorization check — and
// api/upload-document.js / api/upload.js both used
// `dog.tenantId === uid || dog.currentOwnerId === uid`, the READ-level
// check (mirrors firestore.rules' dogBelongsToUser), for what are
// actually WRITE operations. That let a FORMER breeder (tenantId still
// matches, but currentOwnerId has moved to the buyer) upload new
// documents/photos onto a dog they no longer own — exactly the class of
// bug H8 round 1 fixed in firestore.rules (dogWriteAccess/
// isEffectiveDogOwner) but which these two Admin SDK endpoints, being
// rules-bypassing, never inherited. This module is the single shared
// implementation every Admin SDK mutation endpoint must use instead of
// re-deriving its own (and drifting) copy.
//
// currentOwnerId is the ONLY signal once present on a dog document —
// tenantId is permanent PROVENANCE for read (a former breeder legitimately
// keeps read/audit access — see get-signed-url.js/scan-count.js, which
// intentionally keep the broader tenantId-OR-currentOwnerId check for
// exactly that reason, and must NOT be changed to this stricter one) but
// never an ongoing WRITE right. tenantId is a write fallback ONLY for
// legacy dogs that never had currentOwnerId written at all — identical to
// firestore.rules' isEffectiveDogOwner()/dogWriteAccess(), which are
// themselves logically identical to each other (one shared implementation
// here covers both).
export function hasDogWriteAccess(dog, uid) {
  if (!dog || !uid) return false
  if (Object.prototype.hasOwnProperty.call(dog, 'currentOwnerId')) {
    return dog.currentOwnerId === uid
  }
  return Object.prototype.hasOwnProperty.call(dog, 'tenantId') && dog.tenantId === uid
}

// Mirrors firestore.rules' dogAllowsNewRecords(): write access AND the
// dog isn't currently 'restricted' (iDogs Pricing v1.1 §3.3 — a
// restricted dog is read-only, "No new health records or documents").
// Use this (not hasDogWriteAccess alone) for any endpoint that CREATES a
// new dogId-keyed record or new dog-associated content (a document, a
// vaccine/health/worming record, a profile or note photo) — restricted
// status must block new content the same way it does for the equivalent
// client-side Firestore write.
export function canAddDogRecord(dog, uid) {
  return hasDogWriteAccess(dog, uid) && (dog?.status || 'active') !== 'restricted'
}
