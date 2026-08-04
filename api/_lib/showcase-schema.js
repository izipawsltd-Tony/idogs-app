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
// Keep legacy values readable while all new UI writes the three public
// sales states. The public DTO maps on_hold -> reserved and unavailable
// -> sold, so old Showcase documents need no migration.
export const AVAILABILITY_VALUES = Object.freeze(['available', 'reserved', 'sold', 'on_hold', 'unavailable'])
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

// Codex fix-round ("Explicit media publication"): the SAME bound already
// used by api/upload-showcase-media.js's MAX_MEDIA_ITEMS_PER_KIND — a
// puppy can never publish more items than it could possibly have.
export const MAX_PUBLISHED_MEDIA_PER_KIND = 30
export const MAX_PUBLIC_DESCRIPTION_LENGTH = 500

function cleanPublicText(value, fieldName, maxLength) {
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new ShowcaseValidationError(`${fieldName} must be a string`)
  const clean = value.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim()
  if (clean.length > maxLength) throw new ShowcaseValidationError(`${fieldName} must not exceed ${maxLength} characters`)
  return clean || null
}

function cleanMoney(value, fieldName) {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) throw new ShowcaseValidationError(`${fieldName} must be a non-negative integer number of cents`)
  return value
}

// Always returns a COMPLETE four-field entry — never a partial one — so a
// puppy entry can never exist with only some fields set. `existing` is
// the current stored entry for this puppy, if any; `patch` is the
// caller-requested change (only the keys actually present are applied).
// A field simply absent from `patch` leaves the existing (or default, if
// this is the first-ever touch) value untouched — the same
// "absent = untouched" contract litter-schema.js's sanitizeLitterInput
// uses — which is what makes requirement 5 ("availability changes must
// never alter visibility", and vice versa) hold structurally rather than
// by convention, and now extends the same guarantee to
// publishedPhotoIds/publishedVideoIds (selecting photos must never touch
// videos, and vice versa).
//
// publishedPhotoIds/publishedVideoIds are NOT validated here against the
// puppy's actual dog.photos/dog.videos — this endpoint deliberately never
// reads the `dogs` collection (Slice 1 requirement 7). Safety instead
// comes from the READ side: api/showcase-public.js's own projection only
// ever resolves a published id that still exists in the puppy's current
// gallery, silently dropping anything else (see
// api/update-showcase-media.js's own header comment) — a stale or
// fabricated id stored here can never cause anything extra to be shown
// publicly, only cause a real, currently-published item to correctly stop
// appearing once deleted.
export function mergePuppyEntry(existing, patch) {
  const visible = Object.prototype.hasOwnProperty.call(patch, 'visible')
    ? patch.visible
    : (existing?.visible ?? DEFAULT_VISIBLE)
  const availability = Object.prototype.hasOwnProperty.call(patch, 'availability')
    ? patch.availability
    : (existing?.availability ?? DEFAULT_AVAILABILITY)
  const publishedPhotoIds = Object.prototype.hasOwnProperty.call(patch, 'publishedPhotoIds')
    ? patch.publishedPhotoIds
    : (existing?.publishedPhotoIds ?? [])
  const publishedVideoIds = Object.prototype.hasOwnProperty.call(patch, 'publishedVideoIds')
    ? patch.publishedVideoIds
    : (existing?.publishedVideoIds ?? [])
  const optionalFields = ['colour', 'personality', 'readyToGoHomeDate', 'priceCents', 'depositCents', 'showPrice', 'showDeposit']
  const details = Object.fromEntries(optionalFields.map(field => [field,
    Object.prototype.hasOwnProperty.call(patch, field) ? patch[field] : (existing?.[field] ?? (field.startsWith('show') ? false : null))
  ]))
  return { visible, availability, publishedPhotoIds, publishedVideoIds, ...details }
}

function validateMediaIdArray(value, fieldName) {
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && id.length > 0)) {
    throw new ShowcaseValidationError(`${fieldName} must be an array of non-empty id strings`)
  }
  if (value.length > MAX_PUBLISHED_MEDIA_PER_KIND) {
    throw new ShowcaseValidationError(`${fieldName} must not exceed ${MAX_PUBLISHED_MEDIA_PER_KIND} items`)
  }
  if (new Set(value).size !== value.length) {
    throw new ShowcaseValidationError(`${fieldName} must not contain duplicate entries`)
  }
}

const KNOWN_PATCH_FIELDS = ['visible', 'availability', 'publishedPhotoIds', 'publishedVideoIds', 'colour', 'personality', 'readyToGoHomeDate', 'priceCents', 'depositCents', 'showPrice', 'showDeposit']

export function validatePuppyPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ShowcaseValidationError('patch must be an object')
  }
  const hasVisible = Object.prototype.hasOwnProperty.call(patch, 'visible')
  const hasAvailability = Object.prototype.hasOwnProperty.call(patch, 'availability')
  const hasPublishedPhotoIds = Object.prototype.hasOwnProperty.call(patch, 'publishedPhotoIds')
  const hasPublishedVideoIds = Object.prototype.hasOwnProperty.call(patch, 'publishedVideoIds')
  if (!Object.keys(patch).some(k => KNOWN_PATCH_FIELDS.includes(k))) {
    throw new ShowcaseValidationError('patch must include at least one supported field')
  }
  const unknown = Object.keys(patch).filter(k => !KNOWN_PATCH_FIELDS.includes(k))
  if (unknown.length > 0) {
    throw new ShowcaseValidationError(`Unknown field(s): ${unknown.join(', ')}`)
  }
  if (hasVisible && typeof patch.visible !== 'boolean') {
    throw new ShowcaseValidationError('visible must be a boolean')
  }
  if (hasAvailability && !AVAILABILITY_VALUES.includes(patch.availability)) {
    throw new ShowcaseValidationError(`availability must be one of: ${AVAILABILITY_VALUES.join(', ')}`)
  }
  if (hasPublishedPhotoIds) validateMediaIdArray(patch.publishedPhotoIds, 'publishedPhotoIds')
  if (hasPublishedVideoIds) validateMediaIdArray(patch.publishedVideoIds, 'publishedVideoIds')

  if (Object.prototype.hasOwnProperty.call(patch, 'colour')) patch.colour = cleanPublicText(patch.colour, 'colour', 80)
  if (Object.prototype.hasOwnProperty.call(patch, 'personality')) patch.personality = cleanPublicText(patch.personality, 'personality', MAX_PUBLIC_DESCRIPTION_LENGTH)
  if (Object.prototype.hasOwnProperty.call(patch, 'readyToGoHomeDate')) {
    if (patch.readyToGoHomeDate !== null && (typeof patch.readyToGoHomeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(patch.readyToGoHomeDate))) throw new ShowcaseValidationError('readyToGoHomeDate must be YYYY-MM-DD or null')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'priceCents')) patch.priceCents = cleanMoney(patch.priceCents, 'priceCents')
  if (Object.prototype.hasOwnProperty.call(patch, 'depositCents')) patch.depositCents = cleanMoney(patch.depositCents, 'depositCents')
  for (const field of ['showPrice', 'showDeposit']) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && typeof patch[field] !== 'boolean') throw new ShowcaseValidationError(`${field} must be a boolean`)
  }

  const clean = {}
  if (hasVisible) clean.visible = patch.visible
  if (hasAvailability) clean.availability = patch.availability
  if (hasPublishedPhotoIds) clean.publishedPhotoIds = patch.publishedPhotoIds
  if (hasPublishedVideoIds) clean.publishedVideoIds = patch.publishedVideoIds
  for (const field of KNOWN_PATCH_FIELDS.slice(4)) if (Object.prototype.hasOwnProperty.call(patch, field)) clean[field] = patch[field]
  return clean
}

// Tenant-chain + litter-chain validation for a single puppy on the
// PUBLIC read path (api/showcase-public.js) — a mismatch here just drops
// that ONE puppy from the public response; the rest of a legitimately-
// shared showcase must not break because of one bad relationship
// elsewhere. Lives here (not in showcase-public.js itself) so it has no
// Firebase Admin import and can be unit-tested directly with plain
// objects — see scripts/test-showcase-fix-round.mjs.
//
// Fix ("selected puppy missing publicly" — confirmed via staging
// read-only diagnostics against a real litter): a dog document created
// before api/create-litter-puppy.js started writing `litterId` (or
// otherwise never touched by that field) has dog.litterId === undefined
// forever — dogProtectedFieldsUnchanged() in firestore.rules makes
// litterId permanently immutable once a dog exists, so there is no
// client-reachable way for a breeder to ever fix this themselves, and a
// strict `dog.litterId === litterId` check silently dropped the puppy
// from every public response no matter what `visible` was set to.
// `litterPuppyIds` (the actual litter document's own puppyIds array) is
// the SAME membership signal Pricing v1.2's own legacy-record handling
// elsewhere in this codebase falls back to (see api/_lib/dog-cap.js's
// header comment on legacy litter puppies) — used here ONLY when
// litterId is completely absent, never when it's present but points
// elsewhere. A dog with a litterId naming some OTHER litter is never
// matched by this fallback (the `if (dog.litterId)` branch returns false
// for it directly), so this cannot be used to resurface a puppy under
// the wrong litter's page the way a stale/forged litterId could — it
// only recovers a puppy that has NO litterId opinion at all, and even
// then only within a litter whose tenantId the caller has already
// validated matches the Showcase's own tenantId.
export function isValidShowcasePuppyDoc(dogId, dog, showcaseTenantId, litterId, litterPuppyIds) {
  if (dog.tenantId !== showcaseTenantId) return false
  if (dog.litterId) return dog.litterId === litterId
  return litterPuppyIds.has(dogId)
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
// dropped rather than carried forward forever. Availability and
// publishedPhotoIds/publishedVideoIds are never touched by a bulk action
// — only visible; a breeder toggling visibility off/on must never lose
// their per-puppy media publication selections.
export function applyBulkAction(action, existingPuppies, puppyIds) {
  const map = {}
  for (const id of puppyIds) {
    const existing = existingPuppies?.[id]
    const availability = existing?.availability ?? DEFAULT_AVAILABILITY
    const publishedPhotoIds = existing?.publishedPhotoIds ?? []
    const publishedVideoIds = existing?.publishedVideoIds ?? []
    let visible
    if (action === 'select_all') visible = true
    else if (action === 'clear_all') visible = false
    else if (action === 'show_available_only') visible = availability === 'available'
    else throw new ShowcaseValidationError(`Unknown bulk action: ${action}`)
    map[id] = mergePuppyEntry(existing, { visible, availability, publishedPhotoIds, publishedVideoIds })
  }
  return map
}
