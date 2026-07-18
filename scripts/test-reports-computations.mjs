// Breeder Workspace completion batch — pure-function tests for
// src/lib/reports.ts (the "Insights" page's computation layer). These
// functions do no I/O (data is fetched in ReportsPage.tsx and passed
// in), so — like breedingCompliance.ts already is — they're testable
// directly against the compiled output, no emulator needed.
//
// NOTE: src/lib/reports.ts and src/lib/breedingCompliance.ts are plain
// TypeScript modules with no import.meta.env dependency (unlike
// db.ts), so unlike this project's other test scripts they CAN be
// transpiled and imported directly — no mirrored re-implementation
// needed here, this exercises the real production code.
//
// Usage: node scripts/test-reports-computations.mjs
// Bundles reports.ts (and its breedingCompliance.ts/utils.ts imports)
// into one plain-JS ESM file via esbuild --bundle first, since Node's
// ESM loader requires explicit file extensions that the TS source
// doesn't have — bundling sidesteps that rather than rewriting imports.

import { rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '_tmp-reports-test-build')

// Bundle reports.ts (plus its breedingCompliance.ts/utils.ts imports)
// to a single plain-JS ESM file in a throwaway directory, via esbuild
// (already a transitive devDependency of vite). No source files are
// modified; distDir is deleted at the end of this script regardless of
// pass/fail.
execSync(
  `npx esbuild src/lib/reports.ts --bundle --format=esm --outdir="${distDir}" --platform=node`,
  { cwd: path.join(__dirname, '..'), stdio: 'pipe' },
)

const { litterProduction, healthCoverage, salesAndTransfers, breedingOverview, isCurrentKennelDog, currentKennelDogs } =
  await import(pathToFileURL(path.join(distDir, 'reports.js')).href)

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

function dog(overrides = {}) {
  return {
    id: 'd1', tenantId: 't1', passportId: 'X', name: 'Rex', breed: 'Labrador Retriever',
    sex: 'male', dateOfBirth: '2020-01-01', colour: '', microchip: '', ankc: '',
    lifeStage: 'adult', isDeceased: false, originBreederId: 't1', currentOwnerId: 't1',
    photos: [], notes: '', createdAt: '', updatedAt: '',
    ...overrides,
  }
}

// ── isCurrentKennelDog / currentKennelDogs ──
{
  const active = dog({ id: 'a' })
  const deceased = dog({ id: 'b', isDeceased: true })
  const transferred = dog({ id: 'c', status: 'transferred' })
  check('Active, non-deceased, non-transferred dog counts as current kennel', isCurrentKennelDog(active) === true)
  check('Deceased dog excluded from current kennel', isCurrentKennelDog(deceased) === false)
  check('Transferred dog excluded from current kennel', isCurrentKennelDog(transferred) === false)
  const filtered = currentKennelDogs([active, deceased, transferred])
  check('currentKennelDogs filters to exactly the active dog', filtered.length === 1 && filtered[0].id === 'a')
}

// ── litterProduction ──
{
  const dogs = [dog({ id: 'dam1', name: 'Dam One' }), dog({ id: 'sire1', name: 'Sire One', sex: 'male' })]
  const litters = [
    { id: 'l1', tenantId: 't1', name: 'Litter A', damId: 'dam1', sireId: 'sire1', actualBirthDate: '2025-03-01', puppyIds: ['p1', 'p2'], notes: '', createdAt: '' },
    { id: 'l2', tenantId: 't1', name: 'Litter B', damId: 'dam1', sireId: null, sireName: 'External Stud', actualBirthDate: '2025-06-01', puppyIds: ['p3'], notes: '', createdAt: '' },
    { id: 'l3', tenantId: 't1', name: 'Litter C (expected)', damId: 'dam1', expectedDueDate: '2026-09-01', puppyIds: [], notes: '', createdAt: '' },
  ]
  const report = litterProduction(litters, dogs)
  check('litterProduction: born litters counted (2), expected separated (1)', report.rows.length === 2 && report.expected.length === 1)
  check('litterProduction: sire resolved from local dogs by ID', report.rows.find(r => r.id === 'l1').sireName === 'Sire One')
  check('litterProduction: external sire falls back to litter.sireName', report.rows.find(r => r.id === 'l2').sireName === 'External Stud')
  check('litterProduction: byYear aggregates puppy counts and avg size', report.byYear.length === 1 && report.byYear[0].totalPuppies === 3 && report.byYear[0].litterCount === 2)
  check('litterProduction: rows sorted newest whelp date first', report.rows[0].id === 'l2')

  const empty = litterProduction([], dogs)
  check('litterProduction: empty input produces empty report, not a throw', empty.byYear.length === 0 && empty.rows.length === 0 && empty.expected.length === 0)
}

// ── healthCoverage ──
{
  const dogs = [
    dog({ id: 'adult1', lifeStage: 'adult' }),
    dog({ id: 'adult2', lifeStage: 'senior' }),
    dog({ id: 'pup1', lifeStage: 'puppy' }),
    dog({ id: 'gone', lifeStage: 'adult', isDeceased: true }),
  ]
  const healthByDog = new Map([
    ['adult1', [{ id: 'h1', dogId: 'adult1', testType: 'hip', result: 'Excellent', dateTested: '2025-01-01', createdAt: '' }]],
    ['pup1', [{ id: 'h2', dogId: 'pup1', testType: 'hip', result: 'Excellent', dateTested: '2025-01-01', createdAt: '' }]],
  ])
  const report = healthCoverage(dogs, healthByDog)
  check('healthCoverage: eligible count excludes puppies and deceased dogs', report.eligibleCount === 2)
  check('healthCoverage: excludedPuppyCount counts the puppy', report.excludedPuppyCount === 1)
  const hipStat = report.stats.find(s => s.type === 'hip')
  check('healthCoverage: hip coverage counts only eligible (adult) dogs with the test, not the puppy', hipStat.covered === 1 && hipStat.missing === 1 && hipStat.pct === 50)
  const elbowStat = report.stats.find(s => s.type === 'elbow')
  check('healthCoverage: a test type with zero coverage reports pct 0, not NaN', elbowStat.covered === 0 && elbowStat.pct === 0)

  const noEligible = healthCoverage([dog({ id: 'p', lifeStage: 'puppy' })], new Map())
  check('healthCoverage: zero eligible dogs does not throw (division-by-zero guarded)', noEligible.eligibleCount === 0 && noEligible.stats.every(s => s.pct === 0))
}

// ── salesAndTransfers ──
{
  const dogs = [
    dog({ id: 't1id', status: 'transferred', transferredAt: '2025-05-15', buyerName: 'Jane Buyer', buyerEmail: 'jane@example.com' }),
    dog({ id: 't2id', status: 'transferred', transferredAt: '2025-05-20', buyerName: 'Sam Buyer', buyerEmail: 'sam@example.com' }),
    dog({ id: 'res1', availabilityStatus: 'reserved', reservedForName: 'Reserved Buyer', reservedAt: '2026-01-01' }),
    dog({ id: 'avail1', availabilityStatus: 'available' }),
  ]
  const report = salesAndTransfers(dogs)
  check('salesAndTransfers: transfers grouped by month (both in same month)', report.transfersByMonth.length === 1 && report.transfersByMonth[0].count === 2)
  check('salesAndTransfers: funnel counts available/reserved correctly', report.funnel.available === 1 && report.funnel.reserved === 1)
  check('salesAndTransfers: hasSalesData true once any availabilityStatus/depositStatus present', report.hasSalesData === true)
  check('salesAndTransfers: transferredRows carries buyer name/email through', report.transferredRows.some(r => r.buyerEmail === 'jane@example.com'))
  check('salesAndTransfers: reservedRows only includes reserved dogs', report.reservedRows.length === 1 && report.reservedRows[0].dogId === 'res1')

  const noSalesData = salesAndTransfers([dog({ id: 'plain' })])
  check('salesAndTransfers: hasSalesData false when no lifecycle fields present anywhere', noSalesData.hasSalesData === false)
}

// ── breedingOverview (structural behaviour, not compliance-rule detail) ──
{
  const dogs = [
    dog({ id: 'male1', sex: 'male' }),
    dog({ id: 'female-adult', sex: 'female', dateOfBirth: '2020-01-01' }),
    dog({ id: 'female-puppy', sex: 'female', dateOfBirth: new Date().toISOString().slice(0, 10) }),
    dog({ id: 'female-gone', sex: 'female', isDeceased: true }),
  ]
  const report = breedingOverview(dogs, new Map(), 'SA')
  check('breedingOverview: males are excluded from assessment, counted separately', report.excludedMaleCount === 1)
  check('breedingOverview: deceased female excluded entirely (not counted anywhere)', report.notYetCount + report.assessedCount === 2)
  check('breedingOverview: a newborn female routes to notYetOfBreedingAge, not assessed', report.notYetOfBreedingAge.some(r => r.dogId === 'female-puppy') && report.notYetCount === 1)
  check('breedingOverview: an adult female is assessed (appears in eligible/caution/review)', [...report.eligible, ...report.caution, ...report.review].some(r => r.dogId === 'female-adult'))
  check('breedingOverview: assessedCount matches eligible+caution+review length', report.assessedCount === report.eligible.length + report.caution.length + report.review.length)

  const emptyKennel = breedingOverview([], new Map(), 'SA')
  check('breedingOverview: empty kennel produces zeroed report, not a throw', emptyKennel.assessedCount === 0 && emptyKennel.excludedMaleCount === 0)
}

rmSync(distDir, { recursive: true, force: true })
summary()
