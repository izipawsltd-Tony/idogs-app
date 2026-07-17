// Regression coverage for the Create Litter Dam selector fix
// (fix/sire-heat-cycle, follow-up to the Sire selector fix).
//
// Root cause recap: LittersPage's `femalesOnly` was `dogs.filter(d =>
// d.sex === 'female')` — no eligibility filtering at all, unlike
// `malesOnly` (already fixed to use isEligibleSireDog). A transferred or
// puppy-stage female still appeared in the Dam dropdown even though My
// Dogs (which does apply transfer/life-stage exclusions) no longer
// showed her as a current dog. Fixed by factoring the sex-agnostic
// "currently breeder-controlled, living, mature" exclusions out of
// isEligibleSireDog into isCurrentBreederDog, and adding a symmetric
// isEligibleDamDog = isCurrentBreederDog + sex === 'female'.
//
// This file combines pure-logic assertions (mirroring isEligibleDamDog)
// with static source-code assertions that LittersPage and firestore.rules
// actually use it.
//
// Usage: node scripts/test-dam-selector-consistency.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Mirror of lib/utils.ts's calculateLifeStage + isCurrentBreederDog/
// isEligibleDamDog (medium-size brackets only, as in test-sire-eligibility.mjs) ──
function calculateLifeStage(dob) {
  if (!dob) return 'puppy'
  const from = new Date(dob)
  const months = (new Date().getFullYear() - from.getFullYear()) * 12 + (new Date().getMonth() - from.getMonth())
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
function isEligibleDamDog(dog) {
  return dog.sex === 'female' && isCurrentBreederDog(dog)
}

function dobYearsAgo(years) {
  const d = new Date()
  d.setMonth(d.getMonth() - Math.round(years * 12))
  return d.toISOString().slice(0, 10)
}

// ── Test 1: eligible adult female is included ──
{
  const dog = { sex: 'female', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active' }
  check('Adult female, active, alive: eligible Dam', isEligibleDamDog(dog) === true)
}

// ── Test 2: male dogs excluded ──
{
  const dog = { sex: 'male', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active' }
  check('Male dog: never eligible as Dam', isEligibleDamDog(dog) === false)
}

// ── Test 3: puppy females excluded ──
{
  const dog = { sex: 'female', dateOfBirth: dobYearsAgo(0.3), isDeceased: false, status: 'active' }
  check('Puppy-stage female: excluded from Dam selector', isEligibleDamDog(dog) === false)
}

// ── Test 4: transferred females excluded (this is the exact bug — a
// transferred Dam previously stayed selectable) ──
{
  const dog1 = { sex: 'female', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'transferred' }
  const dog2 = { sex: 'female', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active', transferStatus: 'pendingClaim' }
  check('status=transferred female: excluded from Dam selector', isEligibleDamDog(dog1) === false)
  check('transferStatus=pendingClaim female: excluded from Dam selector', isEligibleDamDog(dog2) === false)
}

// ── Test 5: deceased females excluded ──
{
  const dog = { sex: 'female', dateOfBirth: dobYearsAgo(5), isDeceased: true, status: 'active' }
  check('Deceased female: excluded from Dam selector', isEligibleDamDog(dog) === false)
}

// ── Test 6: legacy/malformed records that can't be proven eligible fail
// safe to excluded, never included ──
{
  const noDob = { sex: 'female', isDeceased: false, status: 'active' } // no dateOfBirth at all
  check('Legacy record with no dateOfBirth cannot be proven mature — excluded (fail-safe)', isEligibleDamDog(noDob) === false)

  const badSex = { sex: 'unknown', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active' }
  check('Malformed sex value — excluded, never defaults to included', isEligibleDamDog(badSex) === false)

  const legacyEligible = { sex: 'female', dateOfBirth: dobYearsAgo(4) } // no status/isDeceased fields
  let threw = false, result
  try { result = isEligibleDamDog(legacyEligible) } catch { threw = true }
  check('Legacy dog record (no status/isDeceased fields) does not throw', !threw)
  check('Legacy eligible female dog record resolves to eligible', result === true)
}

// ── Test 7 (structural): LittersPage's femalesOnly uses the shared
// predicate, not a bare sex === 'female' filter ──
{
  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage imports isEligibleDamDog from lib/utils',
    /import\s*\{[^}]*isEligibleDamDog[^}]*\}\s*from\s*'\.\.\/lib\/utils'/.test(littersSrc))
  check('LittersPage femalesOnly is derived from isEligibleDamDog',
    /femalesOnly\s*=\s*dogs\.filter\(isEligibleDamDog\)/.test(littersSrc))
  check('LittersPage no longer uses a bare sex-only filter for femalesOnly',
    !/femalesOnly\s*=\s*dogs\.filter\(d\s*=>\s*d\.sex\s*===\s*'female'\)/.test(littersSrc))
  // Sire filtering must be unchanged (explicitly must not be weakened by this fix)
  check('LittersPage malesOnly still uses isEligibleSireDog (unchanged)',
    /malesOnly\s*=\s*dogs\.filter\(isEligibleSireDog\)/.test(littersSrc))
}

// ── Test 8 (structural): utils.ts factors the shared exclusions into one
// base predicate used by both isEligibleSireDog and isEligibleDamDog,
// so they can't drift apart again ──
{
  const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('utils.ts defines isCurrentBreederDog', /function isCurrentBreederDog\(dog: Dog\)/.test(utilsSrc))
  check('isEligibleSireDog is built on isCurrentBreederDog',
    /export function isEligibleSireDog\(dog: Dog\): boolean \{\s*return dog\.sex === 'male' && isCurrentBreederDog\(dog\)/.test(utilsSrc))
  check('isEligibleDamDog is built on isCurrentBreederDog',
    /export function isEligibleDamDog\(dog: Dog\): boolean \{\s*return dog\.sex === 'female' && isCurrentBreederDog\(dog\)/.test(utilsSrc))
}

// ── Test 9 (structural): firestore.rules independently validates damId
// on litter create — a stale/wrong-tenant Dam must be rejected even if
// the client's selector is bypassed ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules defines isEligibleDam', /function isEligibleDam\(damId\)/.test(rules))
  const littersBlock = (rules.match(/match \/litters\/\{id\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('litters create requires isEligibleDam(damId)', /isEligibleDam\(request\.resource\.data\.damId\)/.test(littersBlock))
  check('litters create still requires tenantId ownership (unchanged)', /request\.resource\.data\.tenantId == request\.auth\.uid/.test(littersBlock))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
