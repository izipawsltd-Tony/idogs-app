// api/_lib/heat-cycle-schema.js — explicit field allowlist + validation
// for Heat Cycle create/update input (Codex round 5, Blocker 5).
//
// api/save-heat-cycle.js previously did `tx.set(cycleRef, { ...cycle,
// dogId, tenantId, createdAt, updatedAt })` / `tx.update(existingRef,
// { ...cycle, dogId, tenantId, updatedAt })` — spreading the ENTIRE
// client-supplied `cycle` object directly into the write. That's mass
// assignment: any field the client includes (known or not) gets
// persisted verbatim, dates are never checked for being real calendar
// dates, and — on UPDATE — a client-supplied `createdAt` could silently
// overwrite the record's real creation timestamp (the field ordering in
// the old spread put `...cycle` BEFORE the explicit overrides, but
// `createdAt` was never in that override list at all on update, so a
// client-sent one would win). This module replaces the spread with an
// explicit allowlist mirroring the actual HeatCycle shape
// (DogDetailPage.tsx's own HeatCycle interface) — unknown fields are
// rejected outright, not silently dropped or silently accepted.

import { isValidCalendarDateString } from './date-utils.js'

export class HeatCycleValidationError extends Error {}

const MAX_SHORT_TEXT = 200
const MAX_NOTES_LENGTH = 5000

const DATE_FIELDS = ['heatStartDate', 'heatEndDate', 'matingDate', 'ultrasoundDate', 'whelpingEstimate', 'whelpingActual']
const SHORT_TEXT_FIELDS = ['matingMethod', 'semenType', 'sireName', 'sireReg', 'sireId', 'sirePedigreeRegister', 'vetClinic', 'whelpingMethod']
const BOOLEAN_FIELDS = ['progesteroneTested', 'pregnancyConfirmed']
const INTEGER_FIELDS = ['heatNumber', 'puppiesBorn', 'puppiesAlive']

// heatNumber is required on CREATE (a heat cycle without a sequence
// number is meaningless) but not re-required on UPDATE (a patch may
// legitimately touch only one or two fields).
export const ALL_FIELDS = [...DATE_FIELDS, ...SHORT_TEXT_FIELDS, ...BOOLEAN_FIELDS, ...INTEGER_FIELDS, 'notes']

function validateDateField(value, fieldName) {
  if (value === '') return ''
  if (typeof value !== 'string') {
    throw new HeatCycleValidationError(`${fieldName} must be a string`)
  }
  if (!isValidCalendarDateString(value)) {
    throw new HeatCycleValidationError(`${fieldName} is not a valid calendar date`)
  }
  return value
}

function validateTextField(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new HeatCycleValidationError(`${fieldName} must be a string`)
  }
  if (value.length > maxLength) {
    throw new HeatCycleValidationError(`${fieldName} is too long (max ${maxLength} characters)`)
  }
  return value
}

function validateBooleanField(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new HeatCycleValidationError(`${fieldName} must be a boolean`)
  }
  return value
}

function validateIntegerField(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new HeatCycleValidationError(`${fieldName} must be a non-negative whole number`)
  }
  return value
}

// Validates `raw` (the client's `cycle` object) against the known
// HeatCycle shape. Rejects any key not on the allowlist, rejects wrong
// types, rejects impossible dates. `requireHeatStartDate` is true on
// CREATE (heatStartDate is mandatory) and false on UPDATE (a patch may
// omit it if it isn't changing). Returns a clean object containing ONLY
// the fields actually present in `raw` — never invents defaults, never
// carries forward id/createdAt/updatedAt/dogId/tenantId, which the
// endpoint itself manages separately and which are deliberately NOT in
// ALL_FIELDS at all (so a client-supplied createdAt is rejected outright
// as an unknown field, not silently accepted then overwritten).
export function sanitizeHeatCycleInput(raw, { requireHeatStartDate }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HeatCycleValidationError('cycle must be an object')
  }
  const unknown = Object.keys(raw).filter(key => !ALL_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new HeatCycleValidationError(`Unknown field(s): ${unknown.join(', ')}`)
  }
  if (requireHeatStartDate && !raw.heatStartDate) {
    throw new HeatCycleValidationError('heatStartDate is required')
  }

  const clean = {}
  for (const field of DATE_FIELDS) {
    if (raw[field] !== undefined) clean[field] = validateDateField(raw[field], field)
  }
  for (const field of SHORT_TEXT_FIELDS) {
    if (raw[field] !== undefined) clean[field] = validateTextField(raw[field], field, MAX_SHORT_TEXT)
  }
  for (const field of BOOLEAN_FIELDS) {
    if (raw[field] !== undefined) clean[field] = validateBooleanField(raw[field], field)
  }
  for (const field of INTEGER_FIELDS) {
    if (raw[field] !== undefined) clean[field] = validateIntegerField(raw[field], field)
  }
  if (raw.notes !== undefined) clean.notes = validateTextField(raw.notes, 'notes', MAX_NOTES_LENGTH)

  return clean
}
