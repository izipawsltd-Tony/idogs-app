import type { Dog, Litter, HealthTest, LifeStage } from '../types'
import { checkDamCompliance, type ComplianceDog, type ComplianceHealthTest, type FindingLevel } from './breedingCompliance'

// ─────────────────────────────────────────────────────────────
// Reports V1 — pure aggregation helpers (no I/O, no Firestore).
// Data is fetched in ReportsPage and passed in, so these stay
// trivially testable. See M7_DATA_MODEL.md §4.
// ─────────────────────────────────────────────────────────────

// Commercial/ownership + breeding-history fields written to Firestore but not yet
// declared on `Dog` (see M7_DATA_MODEL.md §7a). Extended locally so this module is
// type-safe without needing the Dog interface edited first.
export type DogSale = Dog & {
  status?: 'active' | 'transferred'
  availabilityStatus?: 'available' | 'reserved' | 'kept' | 'sold'
  reservedForName?: string
  reservedForEmail?: string
  reservedForPhone?: string
  reservedAt?: string
  depositStatus?: 'none' | 'pending' | 'received'
  depositAmount?: number
  depositReceivedAt?: string
  buyerName?: string
  buyerEmail?: string
  buyerPhone?: string
  transferredAt?: string
  // Breeding history (edited on the Dog compliance tab, stored on the Dog doc)
  pedigreeRegister?: string
  litterCount?: number
  last18mLitters?: number
  cSectionCount?: number
  lastLitterDate?: string
}

// ── Shared "current kennel" filter — SINGLE source of truth ──
// A dog the breeder still holds: not deceased, not transferred out.
// Used by Reports 4.1 and 4.3 (and reusable elsewhere).
export function isCurrentKennelDog(dog: Dog): boolean {
  return !dog.isDeceased && (dog as DogSale).status !== 'transferred'
}
export function currentKennelDogs(dogs: Dog[]): Dog[] {
  return dogs.filter(isCurrentKennelDog)
}

// Life stages that health testing meaningfully applies to.
// Puppies (whelp/puppy) are excluded from coverage %, not counted as "Missing".
const COVERAGE_STAGES: LifeStage[] = ['young_adult', 'adult', 'senior']

// ── 4.2 Litter Production ─────────────────────────────────────
export interface LitterYearStat {
  year: string
  litterCount: number
  totalPuppies: number
  avgLitterSize: number
}
export interface LitterRow {
  id: string
  name: string
  damName: string
  sireName: string     // resolved from local dogs; '—' if none; 'External sire' if off-tenant
  whelpDate: string | null
  puppyCount: number
}
export interface LitterProductionReport {
  byYear: LitterYearStat[]        // sorted, newest year first
  rows: LitterRow[]               // born litters, newest first
  expected: LitterRow[]           // not yet whelped (no actualBirthDate)
}

export function litterProduction(litters: Litter[], dogs: Dog[]): LitterProductionReport {
  const nameById = new Map(dogs.map(d => [d.id, d.name]))

  const toRow = (l: Litter): LitterRow => ({
    id: l.id,
    name: l.name,
    damName: nameById.get(l.damId) || 'Unknown dam',
    sireName: l.sireId ? (nameById.get(l.sireId) || 'External sire') : '—',
    whelpDate: l.actualBirthDate || null,
    puppyCount: l.puppyIds?.length || 0,
  })

  const born = litters.filter(l => !!l.actualBirthDate)
  const expected = litters.filter(l => !l.actualBirthDate)

  const yearMap = new Map<string, { litters: number; puppies: number }>()
  born.forEach(l => {
    const year = (l.actualBirthDate as string).slice(0, 4)
    const acc = yearMap.get(year) || { litters: 0, puppies: 0 }
    acc.litters += 1
    acc.puppies += l.puppyIds?.length || 0
    yearMap.set(year, acc)
  })

  const byYear: LitterYearStat[] = Array.from(yearMap.entries())
    .map(([year, a]) => ({
      year,
      litterCount: a.litters,
      totalPuppies: a.puppies,
      avgLitterSize: a.litters > 0 ? Math.round((a.puppies / a.litters) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.year.localeCompare(a.year))

  const rows = born
    .map(toRow)
    .sort((a, b) => (b.whelpDate || '').localeCompare(a.whelpDate || ''))
  const expectedRows = expected.map(toRow)

  return { byYear, rows, expected: expectedRows }
}

// ── 4.3 Health Test Coverage ──────────────────────────────────
export type CoverageType = 'hip' | 'elbow' | 'eye' | 'dna'
export interface CoverageStat {
  type: CoverageType
  covered: number
  missing: number
  pct: number     // 0–100, rounded
}
export interface HealthCoverageReport {
  eligibleCount: number             // young_adult + adult + senior, current kennel
  excludedPuppyCount: number        // whelp + puppy, shown separately (not "Missing")
  stats: CoverageStat[]
  otherTestsCount: number           // dogs with a cardiac/other test present
}

const CORE_TYPES: CoverageType[] = ['hip', 'elbow', 'eye', 'dna']

export function healthCoverage(
  dogs: Dog[],
  healthByDog: Map<string, HealthTest[]>,
): HealthCoverageReport {
  const kennel = currentKennelDogs(dogs)
  const eligible = kennel.filter(d => COVERAGE_STAGES.includes(d.lifeStage))
  const puppies = kennel.filter(d => d.lifeStage === 'whelp' || d.lifeStage === 'puppy')

  const hasType = (dogId: string, type: string) =>
    (healthByDog.get(dogId) || []).some(t => t.testType === type)

  const stats: CoverageStat[] = CORE_TYPES.map(type => {
    const covered = eligible.filter(d => hasType(d.id, type)).length
    const missing = eligible.length - covered
    const pct = eligible.length > 0 ? Math.round((covered / eligible.length) * 100) : 0
    return { type, covered, missing, pct }
  })

  const otherTestsCount = eligible.filter(
    d => hasType(d.id, 'cardiac') || hasType(d.id, 'other'),
  ).length

  return {
    eligibleCount: eligible.length,
    excludedPuppyCount: puppies.length,
    stats,
    otherTestsCount,
  }
}

// ── 4.4 Sales & Transfers ─────────────────────────────────────
export interface MonthCount { month: string; count: number }   // month = 'YYYY-MM'
export interface TransferRow {
  dogId: string
  dogName: string
  buyerName: string
  buyerEmail: string
  transferredAt: string
}
export interface ReservedRow {
  dogId: string
  dogName: string
  reservedForName: string
  reservedAt: string
}
export interface SalesReport {
  transfersByMonth: MonthCount[]    // newest month first
  funnel: {
    available: number
    reserved: number
    kept: number
    sold: number
    depositReceived: number
  }
  hasSalesData: boolean             // false until Puppy lifecycle fields (module #2) land
  transferredRows: TransferRow[]    // newest first
  reservedRows: ReservedRow[]
}

export function salesAndTransfers(dogs: Dog[]): SalesReport {
  const d = dogs as DogSale[]

  const transferred = d.filter(x => x.status === 'transferred' && x.transferredAt)
  const monthMap = new Map<string, number>()
  transferred.forEach(x => {
    const month = (x.transferredAt as string).slice(0, 7)
    monthMap.set(month, (monthMap.get(month) || 0) + 1)
  })
  const transfersByMonth: MonthCount[] = Array.from(monthMap.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => b.month.localeCompare(a.month))

  const countBy = (s: DogSale['availabilityStatus']) =>
    d.filter(x => x.availabilityStatus === s).length

  const funnel = {
    available: countBy('available'),
    reserved: countBy('reserved'),
    kept: countBy('kept'),
    sold: countBy('sold'),
    depositReceived: d.filter(x => x.depositStatus === 'received').length,
  }

  // hasSalesData: any commercial-lifecycle field present anywhere yet
  const hasSalesData = d.some(x => !!x.availabilityStatus || !!x.depositStatus)

  const transferredRows: TransferRow[] = transferred
    .map(x => ({
      dogId: x.id,
      dogName: x.name,
      buyerName: x.buyerName || '—',
      buyerEmail: x.buyerEmail || '—',
      transferredAt: x.transferredAt as string,
    }))
    .sort((a, b) => b.transferredAt.localeCompare(a.transferredAt))

  const reservedRows: ReservedRow[] = d
    .filter(x => x.availabilityStatus === 'reserved')
    .map(x => ({
      dogId: x.id,
      dogName: x.name,
      reservedForName: x.reservedForName || '—',
      reservedAt: x.reservedAt || '',
    }))
    .sort((a, b) => (b.reservedAt || '').localeCompare(a.reservedAt || ''))

  return { transfersByMonth, funnel, hasSalesData, transferredRows, reservedRows }
}

// ── 4.1 Breeding Overview ─────────────────────────────────────
// Reuses the canonical checkDamCompliance() from breedingCompliance.ts.
// Assesses current-kennel FEMALES only (dam breeding rules); males are counted
// as "not assessed" rather than bucketed. See M7_DATA_MODEL.md §4.1.
export interface BreedingOverviewRow {
  dogId: string
  dogName: string
  overall: FindingLevel     // 'block' | 'warn' | 'info' | 'ok'
  headline: string
}
export interface BreedingOverviewReport {
  eligible: BreedingOverviewRow[]   // overall ok | info
  caution: BreedingOverviewRow[]    // overall warn
  review: BreedingOverviewRow[]     // overall block
  assessedCount: number             // females assessed
  excludedMaleCount: number         // males in kennel, not assessed
}

export function breedingOverview(
  dogs: Dog[],
  healthByDog: Map<string, HealthTest[]>,
  state: string,
): BreedingOverviewReport {
  const kennel = currentKennelDogs(dogs) as DogSale[]
  const females = kennel.filter(d => d.sex === 'female')
  const males = kennel.filter(d => d.sex !== 'female')

  const eligible: BreedingOverviewRow[] = []
  const caution: BreedingOverviewRow[] = []
  const review: BreedingOverviewRow[] = []

  females.forEach(d => {
    const cDog: ComplianceDog = {
      name: d.name,
      breed: d.breed,
      sex: d.sex,
      dateOfBirth: d.dateOfBirth,
      colour: d.colour,
      pedigreeRegister: d.pedigreeRegister,
      litterCount: d.litterCount,
      last18mLitters: d.last18mLitters,
      cSectionCount: d.cSectionCount,
      lastLitterDate: d.lastLitterDate,
    }
    const cTests: ComplianceHealthTest[] = (healthByDog.get(d.id) || []).map(t => ({
      testType: t.testType,
      result: t.result,
      dateTested: t.dateTested,
      lab: t.lab,
      certNumber: t.certNumber,
    }))
    const res = checkDamCompliance(cDog, cTests, state)
    const row: BreedingOverviewRow = { dogId: d.id, dogName: d.name, overall: res.overall, headline: res.headline }
    if (res.overall === 'block') review.push(row)
    else if (res.overall === 'warn') caution.push(row)
    else eligible.push(row)  // 'ok' | 'info'
  })

  return {
    eligible,
    caution,
    review,
    assessedCount: females.length,
    excludedMaleCount: males.length,
  }
}
