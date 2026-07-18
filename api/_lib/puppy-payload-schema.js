// api/_lib/puppy-payload-schema.js — explicit field allowlist +
// validation for the puppy `payload` accepted by
// api/create-litter-puppy.js (Codex round 6, Blocker 4).
//
// Previously the endpoint only checked `payload.sex` (enum) and
// `payload.dateOfBirth` (valid past date) inline, then wrote every other
// field through with a bare `payload.X || ''` fallback — no length
// bound, no type check, no rejection of an unexpected shape (an object,
// an array, a number where a string was expected). This module is the
// single source of truth for that shape, used for creation, for what
// gets persisted into the litterPuppyOperations record, AND for retry
// field-comparison — so all three can never see a different idea of
// what a valid puppy payload looks like.
//
// The returned object is fully NORMALIZED: every one of the 8 fields is
// always present as a real string (or the exact validated sex/
// dateOfBirth value), so downstream comparisons (fieldsMatch in
// create-litter-puppy.js) never need an `?? ''` fallback of their own.

import { isValidCalendarDateString, isFutureDateString } from './date-utils.js'

export class PuppyPayloadValidationError extends Error {}

const MAX_NAME_LENGTH = 100
const MAX_SHORT_FIELD_LENGTH = 100
const MAX_NOTES_LENGTH = 5000

export const PAYLOAD_FIELDS = ['name', 'breed', 'sex', 'dateOfBirth', 'colour', 'microchip', 'ankc', 'notes']

function validateTextField(value, fieldName, maxLength) {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new PuppyPayloadValidationError(`payload.${fieldName} must be a string`)
  }
  if (value.length > maxLength) {
    throw new PuppyPayloadValidationError(`payload.${fieldName} is too long (max ${maxLength} characters)`)
  }
  return value
}

// Validates `raw` (the client's `payload` object) against the known
// puppy-creation shape. Rejects any key not on PAYLOAD_FIELDS, rejects
// non-object/array/unsupported-type payloads outright, rejects an
// invalid or future dateOfBirth, rejects a sex outside the male/female
// enum, and length-bounds every text field. Returns a fully-normalized
// object — every field always present as a plain string (sex/dateOfBirth
// as their validated values) — never partially populated.
export function sanitizePuppyPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PuppyPayloadValidationError('payload must be an object')
  }
  const unknown = Object.keys(raw).filter(key => !PAYLOAD_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new PuppyPayloadValidationError(`Unknown payload field(s): ${unknown.join(', ')}`)
  }

  if (raw.sex !== 'male' && raw.sex !== 'female') {
    throw new PuppyPayloadValidationError('payload.sex must be male or female')
  }
  if (typeof raw.dateOfBirth !== 'string' || !isValidCalendarDateString(raw.dateOfBirth)) {
    throw new PuppyPayloadValidationError('payload.dateOfBirth is not a valid calendar date')
  }
  if (isFutureDateString(raw.dateOfBirth)) {
    throw new PuppyPayloadValidationError('payload.dateOfBirth cannot be in the future')
  }

  return {
    name: validateTextField(raw.name, 'name', MAX_NAME_LENGTH),
    breed: validateTextField(raw.breed, 'breed', MAX_SHORT_FIELD_LENGTH),
    sex: raw.sex,
    dateOfBirth: raw.dateOfBirth,
    colour: validateTextField(raw.colour, 'colour', MAX_SHORT_FIELD_LENGTH),
    microchip: validateTextField(raw.microchip, 'microchip', MAX_SHORT_FIELD_LENGTH),
    ankc: validateTextField(raw.ankc, 'ankc', MAX_SHORT_FIELD_LENGTH),
    notes: validateTextField(raw.notes, 'notes', MAX_NOTES_LENGTH),
  }
}
