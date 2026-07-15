// QR Passport Phase B — focused logic-level coverage for the provenance
// and Remembered-state mapping used by PassportPublicPage.tsx.
//
// No component-testing framework (jest/vitest/testing-library) exists
// in this project, and installing one is disproportionate scope for a
// "smallest focused UI change" task. This script mirrors the exact
// PROVENANCE_VALUES table and isRemembered/provenanceValue computation
// from src/pages/PassportPublicPage.tsx (kept in sync by inspection —
// both are tiny, static, and reviewed together in the same commit) and
// exercises them in isolation, without a DOM. This covers the
// BREEDER_ISSUED/OWNER_CREATED/IMPORTED label and Remembered-detection
// logic without needing a live deceased dog on staging (a real deceased
// fixture would require an authenticated session to create — avoided
// per the task's "no destructive staging edits without approval" rule).
// Live rendering of the non-deceased cases is separately verified
// against real staging dogs via Playwright in this phase's QA — see the
// final report.

// Exact mirror of PassportPublicPage.tsx's PROVENANCE_VALUES.
const PROVENANCE_VALUES = {
  BREEDER_ISSUED: 'Breeder-issued Dog ID',
  OWNER_CREATED: 'Owner-created Dog ID',
  IMPORTED: 'Imported record',
}

// Exact mirror of PassportPublicPage.tsx's isRemembered/provenanceValue computation.
function getProvenanceValue(dog) {
  return PROVENANCE_VALUES[dog.sourceType] || PROVENANCE_VALUES.BREEDER_ISSUED
}
function isRemembered(dog) {
  return dog.isDeceased === true
}

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Provenance labels ──
check('BREEDER_ISSUED -> "Breeder-issued Dog ID"', getProvenanceValue({ sourceType: 'BREEDER_ISSUED' }) === 'Breeder-issued Dog ID')
check('OWNER_CREATED -> "Owner-created Dog ID"', getProvenanceValue({ sourceType: 'OWNER_CREATED' }) === 'Owner-created Dog ID')
check('IMPORTED -> "Imported record"', getProvenanceValue({ sourceType: 'IMPORTED' }) === 'Imported record')
check('Missing/unrecognised sourceType falls back to BREEDER_ISSUED value', getProvenanceValue({ sourceType: undefined }) === 'Breeder-issued Dog ID')
check('Unknown sourceType string falls back to BREEDER_ISSUED value', getProvenanceValue({ sourceType: 'SOMETHING_ELSE' }) === 'Breeder-issued Dog ID')

// ── No banned phrases anywhere in the provenance value set ──
const allValues = Object.values(PROVENANCE_VALUES)
check('No provenance value contains "Verified by iDogs"', !allValues.some(v => v.includes('Verified by iDogs')))
check('No provenance value contains "iDogs verified"', !allValues.some(v => /idogs verified/i.test(v)))
check('No provenance value contains a real person/organisation name placeholder', !allValues.some(v => /kennel|breeder name|owner name/i.test(v)))

// ── Remembered detection ──
check('isDeceased: true -> Remembered', isRemembered({ isDeceased: true }) === true)
check('isDeceased: false -> not Remembered', isRemembered({ isDeceased: false }) === false)
check('isDeceased: missing -> not Remembered (matches API default of false)', isRemembered({}) === false)

// ── Deceased + provenance combine correctly (both fixtures independent) ──
check('A deceased, owner-created dog is both Remembered and Owner-created', isRemembered({ isDeceased: true, sourceType: 'OWNER_CREATED' }) === true && getProvenanceValue({ isDeceased: true, sourceType: 'OWNER_CREATED' }) === 'Owner-created Dog ID')
check('A living, breeder-issued dog is neither Remembered nor shows Owner-created', isRemembered({ isDeceased: false, sourceType: 'BREEDER_ISSUED' }) === false && getProvenanceValue({ isDeceased: false, sourceType: 'BREEDER_ISSUED' }) === 'Breeder-issued Dog ID')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
