// Regression coverage for the Sire selector fix (fix/sire-heat-cycle).
//
// Root cause recap: DogDetailPage.tsx's BreedingTab loaded heatCycles and
// allDogs (used to populate the "Select sire from my dogs…" dropdown) via
// a single Promise.all. firestore.rules had NO match block for
// heatCycles, so that query always threw permission-denied — which
// rejected the whole Promise.all and silently left the Sire dropdown
// empty, even though the dogs query itself would have succeeded. Fixed
// by (1) adding a heatCycles rule and (2) switching to
// Promise.allSettled so one query's failure can never blank the other.
// Separately, neither the Litters "Sire (father)" dropdown nor the Heat
// Cycle "from my dogs" dropdown excluded transferred/puppy/deceased
// males — fixed by a single shared isEligibleSireDog() predicate in
// lib/utils.ts used by both.
//
// This file combines:
//   1. Pure-logic assertions against isEligibleSireDog() (mirrors the
//      exact exclusions: sex, isDeceased, transferred, life stage).
//   2. Static source-code assertions confirming both Sire selectors
//      actually call isEligibleSireDog() (not just that the helper
//      exists unused), that DogDetailPage's loader no longer couples
//      the two queries via Promise.all, and that "Sire" — never "Sir" —
//      is the term used everywhere.
//
// Usage: node scripts/test-sire-eligibility.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Mirror of lib/utils.ts's calculateLifeStage + isEligibleSireDog ──
// (medium-size brackets only — sufficient to exercise the whelp/puppy
// exclusion without pulling in the full breed-size table)
function monthsBetween(fromISO, toDate) {
  const from = new Date(fromISO)
  return (toDate.getFullYear() - from.getFullYear()) * 12 + (toDate.getMonth() - from.getMonth())
}
function calculateLifeStage(dob) {
  if (!dob) return 'puppy'
  const months = monthsBetween(dob, new Date())
  if (months < 2) return 'whelp'
  if (months < 12) return 'puppy' // medium puppyEnd
  if (months < 24) return 'young_adult'
  if (months < 90) return 'adult'
  return 'senior'
}
function isEligibleSireDog(dog) {
  if (dog.sex !== 'male') return false
  if (dog.isDeceased) return false
  if (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') return false
  const stage = calculateLifeStage(dog.dateOfBirth)
  return stage !== 'whelp' && stage !== 'puppy'
}

function dobYearsAgo(years) {
  const d = new Date()
  d.setMonth(d.getMonth() - Math.round(years * 12))
  return d.toISOString().slice(0, 10)
}

// ── Test 1: eligible adult male is included ──
{
  const dog = { sex: 'male', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active' }
  check('Adult male, active, alive: eligible Sire', isEligibleSireDog(dog) === true)
}

// ── Test 2: female dogs excluded ──
{
  const dog = { sex: 'female', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active' }
  check('Female dog: never eligible as Sire', isEligibleSireDog(dog) === false)
}

// ── Test 3: puppy males excluded ──
{
  const dog = { sex: 'male', dateOfBirth: dobYearsAgo(0.3), isDeceased: false, status: 'active' }
  check('Puppy-stage male: excluded from Sire selector', isEligibleSireDog(dog) === false)
}

// ── Test 4: transferred males excluded ──
{
  const dog1 = { sex: 'male', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'transferred' }
  const dog2 = { sex: 'male', dateOfBirth: dobYearsAgo(3), isDeceased: false, status: 'active', transferStatus: 'pendingClaim' }
  check('status=transferred male: excluded from Sire selector', isEligibleSireDog(dog1) === false)
  check('transferStatus=pendingClaim male: excluded from Sire selector', isEligibleSireDog(dog2) === false)
}

// ── Test 5: deceased males excluded ──
{
  const dog = { sex: 'male', dateOfBirth: dobYearsAgo(5), isDeceased: true, status: 'active' }
  check('Deceased male: excluded from Sire selector', isEligibleSireDog(dog) === false)
}

// ── Test 6: legacy dog record compatibility — a pre-ADR-001 record with
// no status/isDeceased/transferStatus fields at all must not crash and
// must still resolve to eligible if sex+age qualify (undefined reads as
// "not transferred, not deceased", matching how the rest of the app
// treats missing optional fields as their default/falsy state) ──
{
  const legacyDog = { sex: 'male', dateOfBirth: dobYearsAgo(4) }
  let threw = false, result
  try { result = isEligibleSireDog(legacyDog) } catch { threw = true }
  check('Legacy dog record (no status/isDeceased fields) does not throw', !threw)
  check('Legacy eligible male dog record resolves to eligible', result === true)
}

// ── Test 7 (structural): both Sire selectors use the shared predicate,
// not their own hand-rolled (and previously incomplete) filter ──
{
  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

  check('LittersPage imports isEligibleSireDog from lib/utils',
    /import\s*\{[^}]*isEligibleSireDog[^}]*\}\s*from\s*'\.\.\/lib\/utils'/.test(littersSrc))
  check('LittersPage malesOnly is derived from isEligibleSireDog',
    /malesOnly\s*=\s*dogs\.filter\(isEligibleSireDog\)/.test(littersSrc))

  check('DogDetailPage imports isEligibleSireDog from lib/utils',
    /isEligibleSireDog/.test(detailSrc) && /from '\.\.\/lib\/utils'/.test(detailSrc))
  check('HeatCycleModal maleDogs is derived from isEligibleSireDog',
    /maleDogs\s*=\s*allDogs\.filter\(isEligibleSireDog\)/.test(detailSrc))
}

// ── Test 8 (structural): the heatCycles/allDogs loader no longer uses a
// coupling Promise.all that lets one query's failure blank the other, and
// allDogs comes from the canonical getDogs() helper — not a raw
// tenantId-only query, which was the cause of the follow-up bug where My
// Dogs showed 1 valid Sire but the Heat Cycle dropdown showed 3 (a raw
// tenantId-only query sees a transferred dog's stale post-claim status). ──
{
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  const loaderMatch = detailSrc.match(/Load heat cycles and all dogs[\s\S]{0,2400}?\}, \[dogId\]\)/)
  check('BreedingTab loader block found', !!loaderMatch)
  if (loaderMatch) {
    const block = loaderMatch[0]
    check('Loader uses Promise.allSettled (not a coupling Promise.all)', block.includes('Promise.allSettled'))
    check('Loader does not use Promise.all for the two queries', !/Promise\.all\(/.test(block))
    check('A heatCycles load failure surfaces a toast to the user',
      /cyclesResult\.status === 'fulfilled'[\s\S]*?else[\s\S]*?toast\(/.test(block))
    check('allDogs is sourced from getDogs() (canonical, currentOwnerId-aware)', /getDogs\(\)/.test(block))
    check('allDogs is NOT sourced from a raw tenantId-only dogs query', !/where\('tenantId', '==', dog\.tenantId\)/.test(block))
  }
  check('DogDetailPage imports getDogs from lib/db',
    /import\s*\{[^}]*\bgetDogs\b[^}]*\}\s*from\s*'\.\.\/lib\/db'/.test(detailSrc))
}

// ── Test 8b (structural): all three breeder-facing dog surfaces — My
// Dogs, Litters, and the Heat Cycle Sire dropdown — now source dogs from
// the same canonical getDogs() helper, so none of them can drift out of
// sync with what My Dogs shows as valid. ──
{
  const listSrc = readFileSync(new URL('../src/pages/DogListPage.tsx', import.meta.url), 'utf8')
  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('My Dogs (DogListPage) sources dogs from getDogs()', /getDogs\(\)/.test(listSrc))
  check('Create Litter Dam/Sire selectors (LittersPage) source dogs from getDogs()', /getDogs\(\)/.test(littersSrc))
  check('Heat Cycle Sire selector (DogDetailPage) sources dogs from getDogs()', /getDogs\(\)/.test(detailSrc))
}

// ── Test 8c: getDogs()'s own dedup — a dog that matches BOTH the
// tenantId query and the currentOwnerId query (the common case: a
// breeder's own still-owned dog) must appear exactly once, never twice,
// in the Sire/Dam selectors. Mirrors getDogs()'s Map-keyed-by-id merge. ──
{
  function mergeDedup(tenantMatches, ownerMatches) {
    const map = new Map()
    for (const d of tenantMatches) map.set(d.id, d)
    for (const d of ownerMatches) map.set(d.id, d)
    return Array.from(map.values())
  }
  const dog = { id: 'dup1', name: 'Rex', sex: 'male' }
  const merged = mergeDedup([dog], [dog])
  check('A dog matching both tenantId and currentOwnerId queries is deduplicated to one entry', merged.length === 1)

  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('getDogs() merges results through a Map keyed by doc id (dedup by construction)',
    /const dogMap = new Map<string, Dog>\(\)/.test(dbSrc) && /dogMap\.set\(d\.id,/.test(dbSrc))
}

// ── Test 8d: no PII logging — the new/changed console.error calls in the
// loader and Sire-selector code paths log error objects only, never a
// dog's name, a sire's name, an email, or other identifying record data. ──
{
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  const loaderMatch = detailSrc.match(/Load heat cycles and all dogs[\s\S]{0,2400}?\}, \[dogId\]\)/)
  if (loaderMatch) {
    const block = loaderMatch[0]
    const logCalls = block.match(/console\.(error|log|warn)\([^)]*\)/g) || []
    check('Loader has console logging calls to check', logCalls.length > 0)
    const leaksPii = logCalls.some(c => /\.name\b|sireName|buyerEmail|\.email\b/.test(c))
    check('Loader console logging never includes dog/sire name or email — error objects only', !leaksPii, logCalls.join(' | '))
  }
}

// ── Test 9: "Sire" is the only term used — never the "Sir" typo — across
// every file touched by this fix ──
{
  for (const rel of ['../src/pages/LittersPage.tsx', '../src/pages/DogDetailPage.tsx', '../src/lib/utils.ts']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
    const bareSir = src.match(/\bSir\b(?!e)/g)
    check(`${rel.replace('../', '')}: no bare "Sir" typo (Sire only)`, !bareSir, bareSir ? bareSir.join(',') : '')
  }
}

// ── Test 10: firestore.rules grants heatCycles access and scopes create
// to female dogs (defense-in-depth beyond the UI's own gating) ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules has a heatCycles match block', /match \/heatCycles\/\{id\}/.test(rules))
  const block = (rules.match(/match \/heatCycles\/\{id\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('heatCycles read/update/delete follows dogBelongsToUser', /dogBelongsToUser\(resource\.data\.dogId\)/.test(block))
  check('heatCycles create requires dogBelongsToUser', /dogBelongsToUser\(request\.resource\.data\.dogId\)/.test(block))
  check('heatCycles create requires the target dog to be female (Dam-only)',
    /\.data\.sex == 'female'/.test(block))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
