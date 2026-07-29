// api/_lib/showcase-schema.js — shared constants + validation for the
// Litter Showcase MVP (Slice 1).
//
// Mirrors this codebase's established pattern (see litter-schema.js,
// puppy-payload-schema.js): an explicit allowlist of accepted values,
// never a bare pass-through of client input. Every field here is
// intentionally independent of Dog's own `availabilityStatus` (M7 #2,
// 'available'|'reserved'|'kept'|'sold') — Showcase never reads or writes
// the Dog document at all, so a puppy's showcase visibility/availability
// can never modify or delete its underlying record (Slice 1 requirement
// 7), and Showcase state can never affect ownership/transfer/claim
// permissions (Slice 1 SECURITY).

export class ShowcaseValidationError extends Error {}

// Slice 1 requirement 4: visibility and availability are two
// independent dimensions per puppy — never derived from one another.
export const AVAILABILITY_VALUES = Object.freeze(['available', 'on_hold', 'reserved', 'unavailable'])
export const DEFAULT_AVAILABILITY = 'available'
export const DEFAULT_VISIBLE = false

// Codex fix-round finding 1: createdAt/updatedAt are written with
// FieldValue.serverTimestamp() (a trusted, server-resolved value — never
// a client- or app-server-clock-controlled `new Date().toISOString()`),
// so every API response must convert the resolved Admin SDK Timestamp
// back to a plain ISO string before it can be safely JSON-serialized —
// this project's own documented convention (see CLAUDE.md's Firestore
// Collections section: `data.createdAt?.toDate?.()?.toISOString() ||
// data.createdAt || ''`), also mirrored server-side by
// api/_lib/dog-cap.js's createdAtKey(). The `|| value || ''` fallback
// keeps this safe even for the (not currently reachable, since callers
// always re-read after a committed write — see readShowcaseForResponse
// in showcase-access.js) case of an unresolved sentinel or a legacy
// plain-string value: it never throws and never leaks a raw Timestamp
// object into a JSON response.
export function resolveTimestampIso(value) {
  return value?.toDate?.()?.toISOString() || value || ''
}

export const BULK_ACTIONS = Object.freeze(['select_all', 'clear_all', 'show_available_only'])

// Always returns a COMPLETE two-field entry — never a partial one — so a
// puppy entry can never exist with only `visible` or only `availability`
// set. `existing` is the current stored entry for this puppy, if any;
// `patch` is the caller-requested change (only the keys actually present
// are applied). A field simply absent from `patch` leaves the existing
// (or default, if this is the first-ever touch) value untouched — the
// same "absent = untouched" contract litter-schema.js's
// sanitizeLitterInput uses — which is what makes requirement 5
// ("availability changes must never alter visibility", and vice versa)
// hold structurally rather than by convention.
export function mergePuppyEntry(existing, patch) {
  const visible = Object.prototype.hasOwnProperty.call(patch, 'visible')
    ? patch.visible
    : (existing?.visible ?? DEFAULT_VISIBLE)
  const availability = Object.prototype.hasOwnProperty.call(patch, 'availability')
    ? patch.availability
    : (existing?.availability ?? DEFAULT_AVAILABILITY)
  return { visible, availability }
}

export function validatePuppyPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ShowcaseValidationError('patch must be an object')
  }
  const hasVisible = Object.prototype.hasOwnProperty.call(patch, 'visible')
  const hasAvailability = Object.prototype.hasOwnProperty.call(patch, 'availability')
  if (!hasVisible && !hasAvailability) {
    throw new ShowcaseValidationError('patch must include visible and/or availability')
  }
  const unknown = Object.keys(patch).filter(k => k !== 'visible' && k !== 'availability')
  if (unknown.length > 0) {
    throw new ShowcaseValidationError(`Unknown field(s): ${unknown.join(', ')}`)
  }
  if (hasVisible && typeof patch.visible !== 'boolean') {
    throw new ShowcaseValidationError('visible must be a boolean')
  }
  if (hasAvailability && !AVAILABILITY_VALUES.includes(patch.availability)) {
    throw new ShowcaseValidationError(`availability must be one of: ${AVAILABILITY_VALUES.join(', ')}`)
  }
  const clean = {}
  if (hasVisible) clean.visible = patch.visible
  if (hasAvailability) clean.availability = patch.availability
  return clean
}

export function validateBulkAction(action) {
  if (!BULK_ACTIONS.includes(action)) {
    throw new ShowcaseValidationError(`action must be one of: ${BULK_ACTIONS.join(', ')}`)
  }
  return action
}

// Applies a bulk action across every CURRENT litter puppyId, returning a
// brand-new, fully-reconciled puppies map — entries for puppies no
// longer in `puppyIds` (e.g. removed via api/remove-litter-puppy.js) are
// dropped rather than carried forward forever. Availability is never
// touched by a bulk action — only visible.
export function applyBulkAction(action, existingPuppies, puppyIds) {
  const map = {}
  for (const id of puppyIds) {
    const existing = existingPuppies?.[id]
    const availability = existing?.availability ?? DEFAULT_AVAILABILITY
    let visible
    if (action === 'select_all') visible = true
    else if (action === 'clear_all') visible = false
    else if (action === 'show_available_only') visible = availability === 'available'
    else throw new ShowcaseValidationError(`Unknown bulk action: ${action}`)
    map[id] = { visible, availability }
  }
  return map
}
