// Regression coverage for the canonical DOB validator (fix/sire-heat-cycle,
// Codex Blocker 2 — unsafe malformed-DOB handling).
//
// Root cause: calculateLifeStage() parsed dateOfBirth with a bare `new
// Date(dob)`. For any malformed-but-non-empty string (e.g. "not-a-date"),
// this produces an Invalid Date, and differenceInMonths() against it
// returns NaN. Every numeric comparison in calculateLifeStage
// (`months < 2`, `months < puppyEnd`, etc.) evaluates NaN comparisons as
// false, so execution fell through every branch to the final `return
// 'senior'` — meaning a dog with a malformed DOB was treated as a mature
// SENIOR dog, i.e. actively ELIGIBLE breeding stock. JS Date also
// silently rolls over impossible calendar dates ("2020-02-30" becomes
// March 1st) instead of rejecting them, and nothing anywhere rejected a
// future DOB.
//
// Fixed with one canonical parseDobStrict() in lib/utils.ts that
// calculateLifeStage (and therefore isCurrentBreederDog/
// isEligibleSireDog/isEligibleDamDog) now goes through — a null result
// fails safe to 'puppy' (never mature), never falls through to 'senior'.
//
// Usage: node scripts/test-dob-validation.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// ── Mirror of lib/utils.ts's parseDobStrict ──
function parseDobStrict(dob) {
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
function calculateLifeStage(dob) {
  const birth = parseDobStrict(dob)
  if (!birth) return 'puppy'
  const months = (new Date().getFullYear() - birth.getFullYear()) * 12 + (new Date().getMonth() - birth.getMonth())
  if (months < 2) return 'whelp'
  if (months < 12) return 'puppy'
  if (months < 24) return 'young_adult'
  if (months < 90) return 'adult'
  return 'senior'
}
function isCurrentBreederDog(dog) {
  if (dog.isDeceased) return false
  if (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') return false
  const stage = calculateLifeStage(dog.dateOfBirth)
  return stage !== 'whelp' && stage !== 'puppy'
}

// Builds a local-calendar-date string directly from a Date's local
// components — never toISOString(), which is UTC and can silently
// shift the calendar date by a day relative to what setMonth()/
// setDate() (local) just computed, depending on the machine's own
// timezone offset (exactly the class of bug this whole file exists to
// catch — see the "future DOB" tests below).
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dobYearsAgo(years) {
  const d = new Date()
  d.setMonth(d.getMonth() - Math.round(years * 12))
  return toLocalDateStr(d)
}

// ── Test 1: valid DOB parses correctly ──
{
  const d = parseDobStrict('2020-06-15')
  check('Valid DOB parses to a real Date', d instanceof Date && !isNaN(d.getTime()))
  check('Parsed Date has the correct year/month/day', d.getFullYear() === 2020 && d.getMonth() === 5 && d.getDate() === 15)
}

// ── Test 2: missing DOB ──
{
  check('undefined is rejected', parseDobStrict(undefined) === null)
  check('null is rejected', parseDobStrict(null) === null)
  check('Empty string is rejected', parseDobStrict('') === null)
}

// ── Test 3: unparsable string ──
{
  check('"not-a-date" is rejected', parseDobStrict('not-a-date') === null)
  check('Wrong separator "2020/01/01" is rejected', parseDobStrict('2020/01/01') === null)
  check('Wrong order "01-01-2020" is rejected', parseDobStrict('01-01-2020') === null)
  check('Partial "2020-01" is rejected', parseDobStrict('2020-01') === null)
}

// ── Test 4: invalid calendar date (JS Date silently rolls these over —
// this is the specific gap parseDobStrict closes with a round-trip check) ──
{
  check('"2020-02-30" (Feb has no 30th) is rejected, not silently rolled to March', parseDobStrict('2020-02-30') === null)
  check('"2020-13-01" (month 13) is rejected', parseDobStrict('2020-13-01') === null)
  check('"2021-02-29" (2021 is not a leap year) is rejected', parseDobStrict('2021-02-29') === null)
  check('"2020-02-29" (2020 IS a leap year) is accepted', parseDobStrict('2020-02-29') !== null)
  check('"2020-00-15" (month 0) is rejected', parseDobStrict('2020-00-15') === null)
  check('"2020-01-00" (day 0) is rejected', parseDobStrict('2020-01-00') === null)
}

// ── Test 5: impossible timestamp/type ──
{
  check('A number is rejected', parseDobStrict(20200101) === null)
  check('A Date object (not a string) is rejected', parseDobStrict(new Date()) === null)
  check('An object is rejected', parseDobStrict({ year: 2020 }) === null)
  check('An array is rejected', parseDobStrict(['2020-01-01']) === null)
  check('A boolean is rejected', parseDobStrict(true) === null)
}

// ── Test 6: future DOB — built via local Y/M/D components throughout
// (toLocalDateStr), never toISOString(), so this test's own "tomorrow"
// can't drift onto the wrong calendar date near a UTC/local day
// boundary (exactly the bug this fix addresses — verified by running
// this suite for real in UTC+9:30, where toISOString()-based "tomorrow"
// could silently compute today's date instead). ──
{
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = toLocalDateStr(tomorrow)
  check('A DOB one day in the future is rejected', parseDobStrict(tomorrowStr) === null)
  check('A DOB far in the future ("2099-01-01") is rejected', parseDobStrict('2099-01-01') === null)
  check("Today's date is accepted (not \"future\")", parseDobStrict(toLocalDateStr(new Date())) !== null)
}

// ── Test 7: malformed legacy value ──
{
  check('Legacy garbage "0000-00-00" is rejected', parseDobStrict('0000-00-00') === null)
  check('Legacy "unknown" placeholder text is rejected', parseDobStrict('unknown') === null)
}

// ── Test 8: an invalid DOB must never qualify a dog as mature breeder
// stock — the exact bug. calculateLifeStage must fail safe to 'puppy',
// never fall through to 'senior'. ──
{
  check('Malformed DOB dog: calculateLifeStage returns \'puppy\' (fail-safe), not \'senior\'', calculateLifeStage('not-a-date') === 'puppy')
  check('Malformed DOB dog: isCurrentBreederDog excludes it (never breeding-eligible)',
    isCurrentBreederDog({ dateOfBirth: 'not-a-date', status: 'active' }) === false)
  check('Impossible calendar date dog: isCurrentBreederDog excludes it', isCurrentBreederDog({ dateOfBirth: '2020-02-30', status: 'active' }) === false)
  check('Future DOB dog: isCurrentBreederDog excludes it', isCurrentBreederDog({ dateOfBirth: '2099-01-01', status: 'active' }) === false)
  check('Missing DOB dog: isCurrentBreederDog excludes it', isCurrentBreederDog({ status: 'active' }) === false)
  check('Valid, mature DOB dog: isCurrentBreederDog still includes it (no regression)',
    isCurrentBreederDog({ dateOfBirth: dobYearsAgo(3), status: 'active' }) === true)
}

// ── Test 9 (structural): lib/utils.ts's real parseDobStrict/
// calculateLifeStage match this mirror, and every DOB-accepting entry
// point (DogNewPage, LittersPage) validates through it ──
{
  const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('utils.ts exports parseDobStrict', /export function parseDobStrict\(dob: unknown\): Date \| null/.test(utilsSrc))
  check('calculateLifeStage is built on parseDobStrict (not a bare `new Date(dob)`)',
    /export function calculateLifeStage[\s\S]{0,120}const birth = parseDobStrict\(dob\)/.test(utilsSrc))
  check('parseDobStrict round-trips year/month/day to reject impossible calendar dates',
    /getFullYear\(\) !== year \|\| parsed\.getMonth\(\) !== month - 1 \|\| parsed\.getDate\(\) !== day/.test(utilsSrc))
  check('parseDobStrict rejects a future date via calendar-component comparison (not an instant/getTime() comparison — timezone-safe)',
    /const isFuture = year > today\.getFullYear\(\)/.test(utilsSrc) && !/parsed\.getTime\(\) > Date\.now\(\)/.test(utilsSrc))

  const dogNewSrc = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')
  check('DogNewPage imports and validates through parseDobStrict before submit',
    /parseDobStrict/.test(dogNewSrc) && /if \(!parseDobStrict\(form\.dateOfBirth\)\)/.test(dogNewSrc))

  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const parseDobStrictCalls = (littersSrc.match(/parseDobStrict\(/g) || []).length
  check('LittersPage validates actualBirthDate through parseDobStrict in at least 3 places (create/save/add-puppy)', parseDobStrictCalls >= 3, `found ${parseDobStrictCalls}`)
}

// ── Test 10 (structural): firestore.rules enforces the same format
// standard (feasible server-side subset — see isValidDobString comment
// for why full age arithmetic isn't attempted in rules) ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules defines isValidDobString with the same YYYY-MM-DD shape', /function isValidDobString\(dob\)/.test(rules) && /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/.test(rules))
  check('dogs create requires isValidDobString', /isValidDobString\(request\.resource\.data\.dateOfBirth\)/.test(rules))
  // Codex round 4, Blocker 3: litters update moved entirely server-side
  // (denied outright in rules) — the actualBirthDate-format-while-
  // puppies-exist invariant is now enforced in api/update-litter.js
  // instead, via api/_lib/litter-schema.js (Codex round 5, Blocker 6 —
  // a real calendar-date + future-rejection check, not just format,
  // and shared with create-litter.js so both endpoints can't drift) —
  // see test-atomic-transactions.mjs Section 4.
  const updateApiSrc = readFileSync(new URL('../api/update-litter.js', import.meta.url), 'utf8')
  const litterSchemaSrc = readFileSync(new URL('../api/_lib/litter-schema.js', import.meta.url), 'utf8')
  check('litters update is denied outright in rules (moved server-side)', /allow create, update, delete: if false;/.test(rules))
  check('api/update-litter.js validates its patch through sanitizeLitterInput (api/_lib/litter-schema.js)',
    /sanitizeLitterInput\(patch, UPDATE_FIELDS\)/.test(updateApiSrc))
  check('api/_lib/litter-schema.js rejects a future actualBirthDate specifically',
    /actualBirthDate.*rejectFuture: true/.test(litterSchemaSrc))
  // Sire/Dam reference DOB validation (the candidate's own DOB must be
  // valid AND actually mature enough) moved server-side in Codex round 3
  // (Blocker 1) — Firestore Rules has no date-arithmetic to check real
  // age, so isEligibleBreedingDog was removed from rules entirely rather
  // than left doing a weaker format-only check. Now covered by
  // parseDobStrictServer + validateBreedingParent in
  // api/_lib/parent-eligibility.js — see test-parent-eligibility.mjs.
  const eligibilitySrc = readFileSync(new URL('../api/_lib/parent-eligibility.js', import.meta.url), 'utf8')
  check('api/_lib/parent-eligibility.js requires the candidate\'s own DOB to be strictly valid (parseDobStrictServer)', /parseDobStrictServer\(dogData\.dateOfBirth\)/.test(eligibilitySrc))
}

await summary()
