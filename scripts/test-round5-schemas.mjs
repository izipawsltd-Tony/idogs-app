// Pure-logic regression coverage for the new server-side validation
// modules introduced in Codex round 5 (and extended round 6):
// api/_lib/litter-eligibility.js's presence-based history checks +
// membership resolution, api/_lib/litter-schema.js,
// api/_lib/heat-cycle-schema.js, api/_lib/http-helpers.js,
// api/_lib/puppy-payload-schema.js (round 6), and
// scripts/rollback-firestore-rules.mjs /
// scripts/verify-rules-release.mjs (round 6). None of these modules
// touch Firestore/Auth directly, so this file needs no emulator — it
// imports and exercises the real code directly, not a mirror.
//
// Usage: node scripts/test-round5-schemas.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { isDogHistoryBearing, isDogSafeToDetach, resolveLitterMembership, partitionConfirmedMembers } from '../api/_lib/litter-eligibility.js'
import { sanitizeLitterInput, LitterValidationError, CREATE_FIELDS, UPDATE_FIELDS } from '../api/_lib/litter-schema.js'
import { sanitizeHeatCycleInput, HeatCycleValidationError, ALL_FIELDS as HEAT_CYCLE_FIELDS } from '../api/_lib/heat-cycle-schema.js'
import { ApiError, parseJsonBody, withApiErrorHandling } from '../api/_lib/http-helpers.js'
import { sanitizePuppyPayload, PuppyPayloadValidationError, PAYLOAD_FIELDS as PUPPY_PAYLOAD_FIELDS } from '../api/_lib/puppy-payload-schema.js'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — isDogHistoryBearing: presence, not truthiness (Codex round
// 5, Blocker 3). Empty string / 0 / false, if PRESENT, must still count
// as history; absent or explicit null must not.
// =========================================================================
{
  check('A dog with no history fields at all is not history-bearing', isDogHistoryBearing({}) === false)
  check('buyerEmail present as a non-empty string is history-bearing', isDogHistoryBearing({ buyerEmail: 'a@b.com' }) === true)
  check('buyerEmail present as an EMPTY STRING is still history-bearing (presence, not truthiness)', isDogHistoryBearing({ buyerEmail: '' }) === true)
  // Codex round 6, Blocker 3: round 5 let an explicit null collapse to
  // "no history" (matching Rules' old .get(field,null)==null default
  // behavior) — that was wrong. A genuinely clean Dog never has these
  // fields written at all; an explicit null is itself an anomalous
  // record and must now fail closed exactly like any other present value.
  check('buyerEmail explicitly null now IS history-bearing (round 6 — explicit null must fail closed, not collapse to "no history")', isDogHistoryBearing({ buyerEmail: null }) === true)
  check('buyerEmail present as a JS-literal undefined value is STILL history-bearing (the key itself is present — hasOwnProperty is true regardless of value)', isDogHistoryBearing({ buyerEmail: undefined }) === true)
  check('buyerEmail present as the literal string "undefined" (a plausible malformed-legacy-migration artifact) is history-bearing', isDogHistoryBearing({ buyerEmail: 'undefined' }) === true)
  check('previousOwnerId alone (empty string) is history-bearing', isDogHistoryBearing({ previousOwnerId: '' }) === true)
  check('previousOwnerId explicitly null alone is history-bearing', isDogHistoryBearing({ previousOwnerId: null }) === true)
  check('transferredAt alone (empty string) is history-bearing', isDogHistoryBearing({ transferredAt: '' }) === true)
  check('transferredAt explicitly null alone is history-bearing', isDogHistoryBearing({ transferredAt: null }) === true)
  check('claimedAt alone (empty string) is history-bearing', isDogHistoryBearing({ claimedAt: '' }) === true)
  check('claimedAt explicitly null alone is history-bearing', isDogHistoryBearing({ claimedAt: null }) === true)
  check('claimedBy ALONE (empty string, no claimedAt) is history-bearing — Codex round 4/5 Blocker 5', isDogHistoryBearing({ claimedBy: '' }) === true)
  check('claimedBy explicitly null alone is history-bearing', isDogHistoryBearing({ claimedBy: null }) === true)
  check('claimedBy present as 0 (falsy but present) is history-bearing', isDogHistoryBearing({ claimedBy: 0 }) === true)
  check('claimedBy present as false (falsy but present) is history-bearing', isDogHistoryBearing({ claimedBy: false }) === true)
  check('An unrelated field (e.g. notes) does not trigger history-bearing', isDogHistoryBearing({ notes: 'hello' }) === false)
  check('A dog with only unrelated fields plus a genuinely clean shape remains not history-bearing', isDogHistoryBearing({ currentOwnerId: 'x', status: 'active', name: 'Rex' }) === false)
}

// =========================================================================
// SECTION 2 — isDogSafeToDetach: combines ownership + transfer status +
// history presence
// =========================================================================
{
  const uid = 'breeder-1'
  const clean = { currentOwnerId: uid, status: 'active' }
  check('A fully clean, currently-owned dog is safe to detach', isDogSafeToDetach(clean, uid) === true)
  check('null dog is never safe to detach', isDogSafeToDetach(null, uid) === false)
  check('Not currently owned by requester -> not safe', isDogSafeToDetach({ currentOwnerId: 'someone-else' }, uid) === false)
  check('status=transferred -> not safe', isDogSafeToDetach({ currentOwnerId: uid, status: 'transferred' }, uid) === false)
  check('transferStatus=pendingClaim -> not safe (even if status looks clean)', isDogSafeToDetach({ currentOwnerId: uid, status: 'active', transferStatus: 'pendingClaim' }, uid) === false)
  check('claimedBy present alone -> not safe', isDogSafeToDetach({ currentOwnerId: uid, status: 'active', claimedBy: 'buyer-uid' }, uid) === false)
  check('buyerEmail present as empty string alone -> not safe (presence, not truthiness)', isDogSafeToDetach({ currentOwnerId: uid, status: 'active', buyerEmail: '' }, uid) === false)
  check('buyerEmail present as explicit null alone -> not safe (round 6 — explicit null fails closed too)', isDogSafeToDetach({ currentOwnerId: uid, status: 'active', buyerEmail: null }, uid) === false)
}

// =========================================================================
// SECTION 3 — resolveLitterMembership: forward-only, reverse-only,
// confirmed, and contradictory membership (Codex round 5, Blocker 2)
// =========================================================================
{
  const litterId = 'litter-1'
  // Confirmed: in puppyIds AND dog.litterId agrees
  const confirmedDog = { id: 'confirmed-1', litterId }
  // Forward-only: in puppyIds, but dog.litterId disagrees (points at a
  // DIFFERENT litter — the "contradictory" case named in the task)
  const contradictoryDog = { id: 'contradictory-1', litterId: 'some-other-litter' }
  // Forward-only: in puppyIds, but dog.litterId is entirely absent (legacy)
  const legacyForwardDog = { id: 'legacy-forward-1' }
  // Reverse-only: dog.litterId agrees, but was never added to puppyIds
  const reverseOnlyDog = { id: 'reverse-only-1', litterId }

  const forwardFetched = [confirmedDog, contradictoryDog, legacyForwardDog] // simulates litter.puppyIds -> these 3 dogs
  const reverseFetched = [confirmedDog, reverseOnlyDog] // simulates a where('litterId','==',litterId) query

  const { confirmed, forwardOnly, reverseOnly, ambiguousCount } = resolveLitterMembership(litterId, forwardFetched, reverseFetched)

  check('Confirmed member (both directions agree) is in confirmed[]', confirmed.some(d => d.id === 'confirmed-1') && confirmed.length === 1)
  check('Contradictory dog (forward-listed, litterId points elsewhere) is in forwardOnly[], not confirmed', forwardOnly.some(d => d.id === 'contradictory-1') && !confirmed.some(d => d.id === 'contradictory-1'))
  check('Legacy forward-only dog (no litterId at all) is in forwardOnly[], not confirmed', forwardOnly.some(d => d.id === 'legacy-forward-1'))
  check('Reverse-only dog (litterId agrees, never in puppyIds) is in reverseOnly[], not confirmed', reverseOnly.some(d => d.id === 'reverse-only-1') && !confirmed.some(d => d.id === 'reverse-only-1'))
  check('ambiguousCount counts both forwardOnly and reverseOnly together', ambiguousCount === forwardOnly.length + reverseOnly.length && ambiguousCount === 3)

  const { eligible, preserved } = partitionConfirmedMembers(confirmed, 'no-owner-set-so-none-eligible')
  check('partitionConfirmedMembers only ever operates on the confirmed set (ambiguous dogs never appear here)', eligible.length + preserved.length === confirmed.length)
}

// =========================================================================
// SECTION 4 — litter-schema.js: explicit allowlist + date validation
// (Codex round 5, Blocker 6)
// =========================================================================
{
  check('A well-formed CREATE input passes and returns only the fields present',
    JSON.stringify(sanitizeLitterInput({ name: 'Luna Litter', actualBirthDate: '2026-01-01' }, CREATE_FIELDS)) ===
    JSON.stringify({ name: 'Luna Litter', actualBirthDate: '2026-01-01' }))

  let unknownFieldThrew = false
  try { sanitizeLitterInput({ name: 'x', tenantId: 'hacked-uid' }, CREATE_FIELDS) } catch (err) { unknownFieldThrew = err instanceof LitterValidationError }
  check('An unknown field (e.g. tenantId) is rejected outright, not silently dropped', unknownFieldThrew)

  let impossibleDateThrew = false
  try { sanitizeLitterInput({ actualBirthDate: '2026-02-30' }, CREATE_FIELDS) } catch (err) { impossibleDateThrew = err instanceof LitterValidationError }
  check('An impossible calendar date (2026-02-30) is rejected', impossibleDateThrew)

  let malformedDateThrew = false
  try { sanitizeLitterInput({ actualBirthDate: 'not-a-date' }, CREATE_FIELDS) } catch (err) { malformedDateThrew = err instanceof LitterValidationError }
  check('A malformed date string is rejected', malformedDateThrew)

  const farFuture = `${new Date().getFullYear() + 5}-01-01`
  let futureBirthThrew = false
  try { sanitizeLitterInput({ actualBirthDate: farFuture }, CREATE_FIELDS) } catch (err) { futureBirthThrew = err instanceof LitterValidationError }
  check('A future actualBirthDate is rejected', futureBirthThrew)

  let futureDueDateOk = true
  try { sanitizeLitterInput({ expectedDueDate: farFuture }, CREATE_FIELDS) } catch { futureDueDateOk = false }
  check('A future expectedDueDate is ALLOWED (a due date is inherently a future prediction)', futureDueDateOk)

  let futureMatingDateOk = true
  try { sanitizeLitterInput({ matingSuspectedDate: farFuture }, CREATE_FIELDS) } catch { futureMatingDateOk = false }
  check('A future matingSuspectedDate is ALLOWED', futureMatingDateOk)

  let wrongTypeThrew = false
  try { sanitizeLitterInput({ name: 12345 }, CREATE_FIELDS) } catch (err) { wrongTypeThrew = err instanceof LitterValidationError }
  check('A wrong-typed field (name as a number) is rejected', wrongTypeThrew)

  let tooLongThrew = false
  try { sanitizeLitterInput({ notes: 'x'.repeat(6000) }, CREATE_FIELDS) } catch (err) { tooLongThrew = err instanceof LitterValidationError }
  check('An oversized notes field is rejected', tooLongThrew)

  let sireNameOnUpdateThrew = false
  try { sanitizeLitterInput({ sireName: 'External Sire' }, UPDATE_FIELDS) } catch (err) { sireNameOnUpdateThrew = err instanceof LitterValidationError }
  check('sireName is not part of UPDATE_FIELDS — attempting it on an update is rejected as unknown', sireNameOnUpdateThrew)

  check('Empty string is accepted for optional date fields (the app\'s "not set" sentinel)',
    sanitizeLitterInput({ matingSuspectedDate: '' }, CREATE_FIELDS).matingSuspectedDate === '')

  check('A field simply absent from input is absent from the result (never defaulted)',
    !Object.prototype.hasOwnProperty.call(sanitizeLitterInput({ name: 'x' }, CREATE_FIELDS), 'notes'))
}

// =========================================================================
// SECTION 5 — heat-cycle-schema.js: mass-assignment protection + date
// validation (Codex round 5, Blocker 5)
// =========================================================================
{
  check('createdAt is NOT in the allowed field list (mass-assignment protection)', !HEAT_CYCLE_FIELDS.includes('createdAt'))
  check('id is NOT in the allowed field list', !HEAT_CYCLE_FIELDS.includes('id'))
  check('dogId is NOT in the allowed field list (set by the endpoint, never the client)', !HEAT_CYCLE_FIELDS.includes('dogId'))
  check('tenantId is NOT in the allowed field list', !HEAT_CYCLE_FIELDS.includes('tenantId'))

  let createdAtInjectionThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', createdAt: '2000-01-01T00:00:00.000Z' }, { requireHeatStartDate: true }) }
  catch (err) { createdAtInjectionThrew = err instanceof HeatCycleValidationError }
  check('Attempting to inject createdAt through cycle input is rejected outright (mass-assignment attempt)', createdAtInjectionThrew)

  let tenantIdInjectionThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', tenantId: 'hacked-uid' }, { requireHeatStartDate: true }) }
  catch (err) { tenantIdInjectionThrew = err instanceof HeatCycleValidationError }
  check('Attempting to inject tenantId through cycle input is rejected outright', tenantIdInjectionThrew)

  let missingRequiredThrew = false
  try { sanitizeHeatCycleInput({ notes: 'no start date' }, { requireHeatStartDate: true }) }
  catch (err) { missingRequiredThrew = err instanceof HeatCycleValidationError }
  check('heatStartDate is required on CREATE', missingRequiredThrew)

  let updateWithoutStartDateOk = true
  try { sanitizeHeatCycleInput({ notes: 'just a note edit' }, { requireHeatStartDate: false }) } catch { updateWithoutStartDateOk = false }
  check('heatStartDate is NOT required on UPDATE (a patch may touch only other fields)', updateWithoutStartDateOk)

  let impossibleHeatStartThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-02-30' }, { requireHeatStartDate: true }) }
  catch (err) { impossibleHeatStartThrew = err instanceof HeatCycleValidationError }
  check('An impossible heatStartDate (2026-02-30) is rejected — "validate heatStartDate as a real date"', impossibleHeatStartThrew)

  let wrongTypePuppiesBornThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', puppiesBorn: 'six' }, { requireHeatStartDate: true }) }
  catch (err) { wrongTypePuppiesBornThrew = err instanceof HeatCycleValidationError }
  check('A wrong-typed numeric field (puppiesBorn as a string) is rejected', wrongTypePuppiesBornThrew)

  let negativePuppiesBornThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', puppiesBorn: -1 }, { requireHeatStartDate: true }) }
  catch (err) { negativePuppiesBornThrew = err instanceof HeatCycleValidationError }
  check('A negative puppiesBorn is rejected', negativePuppiesBornThrew)

  let wrongTypeBooleanThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', pregnancyConfirmed: 'yes' }, { requireHeatStartDate: true }) }
  catch (err) { wrongTypeBooleanThrew = err instanceof HeatCycleValidationError }
  check('A wrong-typed boolean field is rejected', wrongTypeBooleanThrew)

  let unknownFieldThrew = false
  try { sanitizeHeatCycleInput({ heatStartDate: '2026-01-01', totallyMadeUpField: 'x' }, { requireHeatStartDate: true }) }
  catch (err) { unknownFieldThrew = err instanceof HeatCycleValidationError }
  check('An unrelated unknown field is rejected outright', unknownFieldThrew)

  const wellFormed = sanitizeHeatCycleInput({
    heatStartDate: '2026-01-01', heatEndDate: '2026-01-10', matingDate: '2026-01-05',
    puppiesBorn: 6, puppiesAlive: 6, progesteroneTested: true, notes: 'all good',
  }, { requireHeatStartDate: true })
  check('A well-formed, fully-populated cycle input passes and preserves every provided field', wellFormed.heatStartDate === '2026-01-01' && wellFormed.puppiesBorn === 6 && wellFormed.progesteroneTested === true)
}

// =========================================================================
// SECTION 6 — http-helpers.js: malformed JSON -> 400, sanitized 500s
// (Codex round 5, Blocker 9)
// =========================================================================
{
  let malformedThrew = false
  try { parseJsonBody({ body: '{not valid json' }) } catch (err) { malformedThrew = err instanceof ApiError && err.status === 400 }
  check('Malformed JSON string body throws ApiError(400), not an uncaught SyntaxError', malformedThrew)

  const parsedFromObject = parseJsonBody({ body: { already: 'parsed' } })
  check('An already-parsed object body (Vercel\'s normal case) passes through unchanged', parsedFromObject.already === 'parsed')

  const parsedFromValidString = parseJsonBody({ body: '{"a":1}' })
  check('A valid JSON string body is parsed correctly', parsedFromValidString.a === 1)

  const emptyBody = parseJsonBody({ body: undefined })
  check('An undefined/empty body parses to an empty object, not a throw', typeof emptyBody === 'object' && Object.keys(emptyBody).length === 0)

  let arrayBodyThrew = false
  try { parseJsonBody({ body: '[1,2,3]' }) } catch (err) { arrayBodyThrew = err instanceof ApiError && err.status === 400 }
  check('A JSON array body (not an object) is rejected', arrayBodyThrew)

  // withApiErrorHandling: an ApiError is surfaced with its declared
  // status/message; any OTHER thrown error is sanitized to a generic
  // 500 with no err.message leak, and the underlying detail is only
  // ever passed to console.error (server-side), never the response.
  function fakeRes() {
    const res = { statusCode: null, body: null }
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (obj) => { res.body = obj; return res }
    return res
  }
  const apiErrorHandler = withApiErrorHandling('test-context', async () => { throw new ApiError(409, 'Specific conflict reason') })
  const res1 = fakeRes()
  await apiErrorHandler({}, res1)
  check('An ApiError thrown inside a handler surfaces its own status', res1.statusCode === 409)
  check('An ApiError thrown inside a handler surfaces its own message', res1.body.error === 'Specific conflict reason')

  const originalConsoleError = console.error
  let loggedArgs = null
  console.error = (...args) => { loggedArgs = args }
  const genericErrorHandler = withApiErrorHandling('test-context', async () => { throw new Error('some internal secret detail, e.g. a stack-adjacent path or field name') })
  const res2 = fakeRes()
  await genericErrorHandler({}, res2)
  console.error = originalConsoleError

  check('A generic (non-ApiError) thrown error is sanitized to a 500', res2.statusCode === 500)
  check('The sanitized 500 response body does NOT contain the real error message', JSON.stringify(res2.body).includes('internal secret detail') === false)
  check('The sanitized 500 response body is exactly {error: "Internal error"} — no message/stack leaked', JSON.stringify(res2.body) === JSON.stringify({ error: 'Internal error' }))
  check('The real error detail WAS logged server-side (console.error), just never sent to the client', loggedArgs !== null && String(loggedArgs.join(' ')).includes('internal secret detail'))
}

// =========================================================================
// SECTION 7 — scripts/rollback-firestore-rules.mjs: fixes the actual
// deployed-rules file, not a side file (Codex round 5, Blocker 8)
// =========================================================================
{
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')
  const rulesPath = `${repoRoot}/firestore.rules`.replace(/\\/g, '/')
  const originalContent = readFileSync(rulesPath, 'utf8')

  let scriptOutput = ''
  let scriptFailed = false
  try {
    scriptOutput = execFileSync('node', ['scripts/rollback-firestore-rules.mjs', 'ae469147'], { cwd: repoRoot, encoding: 'utf8' })
  } catch (err) {
    scriptFailed = true
    scriptOutput = String(err.stdout || err.message || '')
  }
  check('rollback-firestore-rules.mjs runs successfully against a known-good historical ref', !scriptFailed, scriptOutput)

  const restoredContent = readFileSync(rulesPath, 'utf8')
  check('firestore.rules (the ACTUAL file firebase.json points at) was overwritten with the old ref\'s content', restoredContent !== originalContent && restoredContent.includes('rules_version'))
  check('The old content was backed up to a timestamped file before being overwritten', scriptOutput.includes('Backed up CURRENT firestore.rules to:'))

  // Extract the backup path the script printed and confirm it exists,
  // contains the ORIGINAL (pre-rollback) content, then clean it up.
  const backupMatch = scriptOutput.match(/Backed up CURRENT firestore\.rules to: (.+)/)
  let backupRestoresOriginal = false
  if (backupMatch) {
    const backupPath = backupMatch[1].trim()
    if (existsSync(backupPath)) {
      backupRestoresOriginal = readFileSync(backupPath, 'utf8') === originalContent
      unlinkSync(backupPath)
    }
  }
  check('The backup file genuinely contains the pre-rollback (original) content', backupRestoresOriginal)

  // Restore the real firestore.rules back to its actual HEAD content —
  // this test must never leave the working tree modified.
  writeFileSync(rulesPath, originalContent, 'utf8')
  check('firestore.rules was restored to its original content after this test (working tree left clean)', readFileSync(rulesPath, 'utf8') === originalContent)

  let missingRefFailed = false
  try { execFileSync('node', ['scripts/rollback-firestore-rules.mjs'], { cwd: repoRoot, encoding: 'utf8' }) } catch { missingRefFailed = true }
  check('Running the script with no git-ref argument fails (usage error) rather than doing something undefined', missingRefFailed)
}

// =========================================================================
// SECTION 8 — puppy-payload-schema.js: explicit allowlist + validation
// for api/create-litter-puppy.js's `payload` (Codex round 6, Blocker 4)
// =========================================================================
{
  const validPayload = { name: 'Rex', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: 'Black', microchip: '123456', ankc: '2100123', notes: 'Friendly' }
  const normalized = sanitizePuppyPayload(validPayload)
  check('A well-formed payload passes and every field is preserved', normalized.name === 'Rex' && normalized.breed === 'Poodle' && normalized.colour === 'Black')
  check('The normalized result always has all 8 fields present, even if the input omitted optional ones', PUPPY_PAYLOAD_FIELDS.every(f => Object.prototype.hasOwnProperty.call(sanitizePuppyPayload({ sex: 'female', dateOfBirth: '2026-01-01' }), f)))

  let unknownFieldThrew = false
  try { sanitizePuppyPayload({ ...validPayload, tenantId: 'hacked-uid' }) } catch (err) { unknownFieldThrew = err instanceof PuppyPayloadValidationError }
  check('An unknown field (e.g. tenantId) is rejected outright', unknownFieldThrew)

  let objectFieldThrew = false
  try { sanitizePuppyPayload({ ...validPayload, name: { first: 'Rex' } }) } catch (err) { objectFieldThrew = err instanceof PuppyPayloadValidationError }
  check('An object where a string is expected (name) is rejected', objectFieldThrew)

  let arrayFieldThrew = false
  try { sanitizePuppyPayload({ ...validPayload, notes: ['a', 'b'] }) } catch (err) { arrayFieldThrew = err instanceof PuppyPayloadValidationError }
  check('An array where a string is expected (notes) is rejected', arrayFieldThrew)

  let payloadItselfAnArrayThrew = false
  try { sanitizePuppyPayload(['not', 'an', 'object']) } catch (err) { payloadItselfAnArrayThrew = err instanceof PuppyPayloadValidationError }
  check('A payload that is itself an array (not an object) is rejected', payloadItselfAnArrayThrew)

  let numberFieldThrew = false
  try { sanitizePuppyPayload({ ...validPayload, breed: 12345 }) } catch (err) { numberFieldThrew = err instanceof PuppyPayloadValidationError }
  check('A number where a string is expected (breed) is rejected', numberFieldThrew)

  let oversizedNameThrew = false
  try { sanitizePuppyPayload({ ...validPayload, name: 'x'.repeat(200) }) } catch (err) { oversizedNameThrew = err instanceof PuppyPayloadValidationError }
  check('An oversized name (200 chars, over the 100-char limit) is rejected', oversizedNameThrew)

  let oversizedNotesThrew = false
  try { sanitizePuppyPayload({ ...validPayload, notes: 'x'.repeat(6000) }) } catch (err) { oversizedNotesThrew = err instanceof PuppyPayloadValidationError }
  check('Oversized notes (6000 chars, over the 5000-char limit) is rejected', oversizedNotesThrew)

  let badSexThrew = false
  try { sanitizePuppyPayload({ ...validPayload, sex: 'unknown' }) } catch (err) { badSexThrew = err instanceof PuppyPayloadValidationError }
  check('sex outside the male/female enum is rejected', badSexThrew)

  let impossibleDateThrew = false
  try { sanitizePuppyPayload({ ...validPayload, dateOfBirth: '2026-02-30' }) } catch (err) { impossibleDateThrew = err instanceof PuppyPayloadValidationError }
  check('An impossible calendar date (2026-02-30) is rejected', impossibleDateThrew)

  const farFuture = `${new Date().getFullYear() + 5}-01-01`
  let futureDateThrew = false
  try { sanitizePuppyPayload({ ...validPayload, dateOfBirth: farFuture }) } catch (err) { futureDateThrew = err instanceof PuppyPayloadValidationError }
  check('A future dateOfBirth is rejected', futureDateThrew)

  let missingDateThrew = false
  try { sanitizePuppyPayload({ ...validPayload, dateOfBirth: undefined }) } catch (err) { missingDateThrew = err instanceof PuppyPayloadValidationError }
  check('A missing dateOfBirth is rejected (required, unlike the other free-text fields)', missingDateThrew)

  let nullPayloadThrew = false
  try { sanitizePuppyPayload(null) } catch (err) { nullPayloadThrew = err instanceof PuppyPayloadValidationError }
  check('A null payload is rejected', nullPayloadThrew)
}

// =========================================================================
// SECTION 9 — scripts/verify-rules-release.mjs: non-mutating rollback
// verification (Codex round 6, Blocker 6). Only the offline/argument-
// validation paths are exercised here — the live Firebase Rules API call
// itself needs real network + auth and is documented, not executed, in
// this suite (see the round 6 report's limitations section).
// =========================================================================
{
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')

  let noArgsFailed = false
  try { execFileSync('node', ['scripts/verify-rules-release.mjs'], { cwd: repoRoot, encoding: 'utf8' }) } catch (err) { noArgsFailed = err.status === 2 }
  check('Running with no arguments fails with a usage error (exit 2), not a crash or a false pass', noArgsFailed)

  let missingLocalFileFailed = false
  try { execFileSync('node', ['scripts/verify-rules-release.mjs', 'idogs-app-staging', 'a-file-that-does-not-exist.rules'], { cwd: repoRoot, encoding: 'utf8' }) }
  catch (err) { missingLocalFileFailed = err.status === 2 }
  check('Running with a nonexistent local rules file fails with a usage error (exit 2)', missingLocalFileFailed)

  // Codex round 7, Blocker 2: the fetch/comparison logic these checks
  // inspect moved out of verify-rules-release.mjs (now a thin CLI
  // wrapper) into scripts/_lib/rules-release-verifier.mjs so it could be
  // unit-tested with mocked fetch/credential — see
  // scripts/test-verify-rules-release.mjs for the behavioral tests.
  // These two files together are still "the script" for source-pattern
  // purposes.
  const scriptSrc = readFileSync(`${repoRoot}/scripts/verify-rules-release.mjs`, 'utf8') +
    readFileSync(`${repoRoot}/scripts/_lib/rules-release-verifier.mjs`, 'utf8')
  check('The script only ever issues GET requests (fetch calls with no method/body — read-only)', !/method:\s*['"]POST['"]|method:\s*['"]PUT['"]|method:\s*['"]DELETE['"]/.test(scriptSrc))
  check('The script never references any business-data collection (dogs/litters/users/heatCycles)', !/collection\(['"](?:dogs|litters|users|heatCycles)['"]\)/.test(scriptSrc))
  check('The script independently asserts the release response identifies the requested projectId before trusting it (wrong-project safety)', /expectedPrefix/.test(scriptSrc) && /startsWith\(expectedPrefix\)/.test(scriptSrc))
  check('A mismatched/unverifiable response throws rather than silently reporting a match', /refusing to trust it/.test(scriptSrc))
}

await summary()
