// api/_lib/litter-schema.js — explicit field allowlist + validation for
// litter create/update input (Codex round 5, Blocker 6).
//
// Previously, api/create-litter.js destructured a fixed set of named
// fields from the request body (an implicit allowlist — unknown fields
// were already silently dropped, never persisted) but never validated
// that matingSuspectedDate/expectedDueDate/actualBirthDate were REAL
// calendar dates, or that actualBirthDate wasn't future-dated, or bounded
// name/notes length — relying entirely on client-side (LittersPage.tsx)
// validation, which a direct API call bypasses outright. This module is
// the trusted, server-side equivalent, used by both create-litter.js
// (full field set) and update-litter.js (patch subset).

import { isValidCalendarDateString, isFutureDateString } from './date-utils.js'

export class LitterValidationError extends Error {}

const MAX_NAME_LENGTH = 200
const MAX_NOTES_LENGTH = 5000

export const CREATE_FIELDS = ['name', 'sireName', 'matingSuspectedDate', 'expectedDueDate', 'actualBirthDate', 'notes']
export const UPDATE_FIELDS = ['name', 'matingSuspectedDate', 'expectedDueDate', 'actualBirthDate', 'notes']

// Mating/due dates are legitimately allowed to be in the future (a due
// date IS a future prediction) — only actualBirthDate (a real, already-
// happened event) rejects a future value. Empty string is the app's
// established "not set yet" sentinel for these optional date fields
// (matches the existing '' fallback in create-litter.js/LittersPage.tsx)
// and is always accepted without format checking.
function validateDateField(value, fieldName, { rejectFuture }) {
  if (value === '') return ''
  if (typeof value !== 'string') {
    throw new LitterValidationError(`${fieldName} must be a string`)
  }
  if (!isValidCalendarDateString(value)) {
    throw new LitterValidationError(`${fieldName} is not a valid calendar date`)
  }
  if (rejectFuture && isFutureDateString(value)) {
    throw new LitterValidationError(`${fieldName} cannot be in the future`)
  }
  return value
}

function validateTextField(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new LitterValidationError(`${fieldName} must be a string`)
  }
  if (value.length > maxLength) {
    throw new LitterValidationError(`${fieldName} is too long (max ${maxLength} characters)`)
  }
  return value
}

// Validates `raw` against `allowedFields`: rejects any key not on the
// list, rejects wrong types, rejects impossible/future dates. Returns a
// clean object containing ONLY the fields actually present in `raw` — a
// field simply absent from the input is left out of the result entirely
// (never invented, never defaulted), which is what lets update-litter.js
// treat "field absent from patch" as "leave this field untouched".
export function sanitizeLitterInput(raw, allowedFields) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LitterValidationError('Litter input must be an object')
  }
  const unknown = Object.keys(raw).filter(key => !allowedFields.includes(key))
  if (unknown.length > 0) {
    throw new LitterValidationError(`Unknown field(s): ${unknown.join(', ')}`)
  }

  const clean = {}
  if (allowedFields.includes('name') && raw.name !== undefined) {
    clean.name = validateTextField(raw.name, 'name', MAX_NAME_LENGTH)
  }
  if (allowedFields.includes('sireName') && raw.sireName !== undefined) {
    clean.sireName = validateTextField(raw.sireName, 'sireName', MAX_NAME_LENGTH)
  }
  if (allowedFields.includes('notes') && raw.notes !== undefined) {
    clean.notes = validateTextField(raw.notes, 'notes', MAX_NOTES_LENGTH)
  }
  if (allowedFields.includes('matingSuspectedDate') && raw.matingSuspectedDate !== undefined) {
    clean.matingSuspectedDate = validateDateField(raw.matingSuspectedDate, 'matingSuspectedDate', { rejectFuture: false })
  }
  if (allowedFields.includes('expectedDueDate') && raw.expectedDueDate !== undefined) {
    clean.expectedDueDate = validateDateField(raw.expectedDueDate, 'expectedDueDate', { rejectFuture: false })
  }
  if (allowedFields.includes('actualBirthDate') && raw.actualBirthDate !== undefined) {
    clean.actualBirthDate = validateDateField(raw.actualBirthDate, 'actualBirthDate', { rejectFuture: true })
  }
  return clean
}
