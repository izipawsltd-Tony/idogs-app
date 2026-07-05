// ─────────────────────────────────────────────────────────────────────────────
// breedingCompliance.ts
// iDogs — Breeding compliance engine (3-layer model)
//
//   Layer 1: ANKC_NATIONAL      — Dogs Australia Regulations Part 6 (eff. 1 Jan 2027 doc,
//                                  amended Apr 2026). Consequence: registration outcome.
//   Layer 2: STATE_LAW          — State animal welfare law (e.g. SA Standards & Guidelines
//                                  2017 under Animal Welfare Act 1985). Consequence: legal.
//   Layer 3: KENNEL_CLUB_STATE  — State member body Code of Ethics (Dogs SA etc.).
//                                  Consequence: membership/ethics.
//
// Location: src/lib/breedingCompliance.ts
// Consumers: DogDetailPage.tsx (BreedingTab), LittersPage (litter registration gate)
//
// IMPORTANT — verification status is tracked per rule (`verified` flag).
//   verified: true  → traced to a source document we hold (ANKC Part 6, SA S&G 2017)
//   verified: false → carried over from prior STATE_RULES or third-hand (e.g. Dogs SA
//                     email claiming max age 7); confirm before treating as hard rule.
//
// No React / Firestore imports — pure functions, unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateLifeStage } from './utils'

// ── Types ────────────────────────────────────────────────────────────────────

export type RuleSource = 'ANKC_NATIONAL' | 'STATE_LAW' | 'KENNEL_CLUB_STATE'

export type Consequence =
  | 'LEGAL_OFFENCE'            // breach of state law (expiation/prosecution)
  | 'LITTER_NOT_REGISTRABLE'   // ANKC will not register the litter at all
  | 'LIMITED_REGISTER'         // litter registered Limited only, "never to be upgraded"
  | 'VET_CERT_REQUIRED'        // proceed only with written veterinary certificate
  | 'ETHICS_BREACH'            // kennel club membership consequence
  | 'INFO'

export type FindingLevel = 'block' | 'warn' | 'info' | 'ok'

export interface Finding {
  level: FindingLevel
  source: RuleSource
  consequence: Consequence
  /** Short UI message (safe to render directly) */
  message: string
  /** Citation, e.g. "ANKC Part 6, 8.12.2" or "SA S&G 2017, Std 10.1.1.1" */
  rule: string
  /** false = number carried over / unconfirmed — surface differently in UI if desired */
  verified: boolean
}

/** 'not_yet' = whelp/puppy — excluded from assessment, not a warning. */
export type ComplianceOverall = FindingLevel | 'not_yet'

export interface ComplianceResult {
  overall: ComplianceOverall        // worst of all findings ('ok' if none negative); 'not_yet' if excluded
  headline: string                 // one-line summary for the badge
  findings: Finding[]
}

/** Minimal structural shape — adapt/spread from your Dog type. */
export interface ComplianceDog {
  name?: string
  breed?: string
  sex?: 'male' | 'female' | string
  dateOfBirth?: string             // ISO
  colour?: string
  pedigreeRegister?: string        // 'main' | 'limited' | 'no_pedigree' | 'mixed' | 'rescue'
  litterCount?: number
  last18mLitters?: number
  cSectionCount?: number
  lastLitterDate?: string
}

/** Minimal structural shape — adapt from your HealthTest type. */
export interface ComplianceHealthTest {
  testType?: string                // 'hip' | 'elbow' | 'eye' | 'dna' | free text
  result?: unknown                 // string or { left, right } etc.
  dateTested?: string              // ISO
  lab?: string
  certNumber?: string
}

export interface ComplianceInput {
  dam: ComplianceDog
  damHealthTests?: ComplianceHealthTest[]
  sire?: ComplianceDog
  sireHealthTests?: ComplianceHealthTest[]
  /** State code, e.g. 'SA'. Falls back to 'SA'. */
  state?: string
  /** Proposed mating date (ISO). Defaults to today. Whelping estimated +63 days. */
  matingDate?: string
}

// ── State rules (Layer 2 + 3) ────────────────────────────────────────────────

export interface StateRules {
  stateName: string
  minBreedingMonths: number
  maxLifetimeLitters: number
  /** true → the lifetime-litter cap has a written-vet-certificate exemption */
  lifetimeLittersVetExemption: boolean
  lifetimeLittersSource: RuleSource
  lifetimeLittersRule: string
  lifetimeLittersVerified: boolean
  /** 999 = no rule */
  maxLittersIn18Months: number
  littersIn18mSource: RuleSource
  littersIn18mVerified: boolean
  maxCsections: number | null
  csectionVetRequired: number | null
  /** Age (years) at/after which a current vet certificate is required at mating */
  vetCertAfterAgeYears: number
  vetCertAfterAgeSource: RuleSource
  vetCertAfterAgeRule: string
  vetCertAfterAgeVerified: boolean
  requiresBIN: boolean
  notes: string
  sourceName: string
  sourceUrl: string
}

export const STATE_RULES: Record<string, StateRules> = {
  SA: {
    stateName: 'South Australia',
    minBreedingMonths: 12,
    // SA S&G 2017 Std 10.1.1.1 — max 5 litters UNLESS vet has certified in writing
    // that she is fit. This is a vet-cert gate, NOT a hard block.
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: true,
    lifetimeLittersSource: 'STATE_LAW',
    lifetimeLittersRule: 'SA S&G 2017, Std 10.1.1.1 (Animal Welfare Act 1985)',
    lifetimeLittersVerified: true,
    // NOTE: SA S&G 2017 has NO litter-frequency rule for DOGS (10.1.1.2 is queens/cats
    // only). "2 in 18 months" can only come from Dogs SA Code of Ethics — UNVERIFIED
    // until we hold the CoE document.
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    // ANKC Part 6, 8.3 — bitch ≥8y at mating needs vet cert issued within 3 months
    // prior to mating. Dogs SA email claimed max age 7 — NOT found in any document
    // we hold. Do not change to 7 until Dogs SA CoE is verified.
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Dogs SA membership (DACO) required. Vet cert for ≥8y must be dated within 3 months prior to mating.',
    sourceName: 'SA Standards & Guidelines 2017 + ANKC Part 6 + Dogs SA CoE (pending)',
    sourceUrl: 'https://www.dogssa.com.au/about/policies/dogs-sa-code-of-ethics-for-members-part-xv-codes/',
  },
  NSW: {
    stateName: 'New South Wales',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW',
    lifetimeLittersRule: 'NSW POCTA 1979 (amended 2024)',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 999,
    littersIn18mSource: 'STATE_LAW',
    littersIn18mVerified: false,
    maxCsections: 3,
    csectionVetRequired: 2,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: true,
    notes: 'BIN mandatory from 1 Dec 2025. Max 5 litters OR 3 C-sections lifetime, whichever first. Vet cert before 3rd C-section pregnancy.',
    sourceName: 'NSW Prevention of Cruelty to Animals Act 1979 (amended 2024)',
    sourceUrl: 'https://www.olg.nsw.gov.au/pets/nsw-pet-registry/breeders/changes-dog-breeding-laws',
  },
  VIC: {
    stateName: 'Victoria',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'Dogs Victoria Code of Practice',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Dogs Victoria AO status: up to 10 fertile females. PER source number required for all ads.',
    sourceName: 'Dogs Victoria Code of Practice',
    sourceUrl: 'https://dogsvictoria.org.au/media/6000/dv-code-of-practice-effective-150224.pdf',
  },
  QLD: {
    stateName: 'Queensland',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'Dogs Queensland rules',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Register as breeder within 28 days of litter. Supply number required for all ads.',
    sourceName: 'Animal Care and Protection Act 2001 (QLD)',
    sourceUrl: 'https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/animal/industries/dogs',
  },
  WA: {
    stateName: 'Western Australia',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'CAWA H Regulations',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 999,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 7,
    vetCertAfterAgeSource: 'KENNEL_CLUB_STATE',
    vetCertAfterAgeRule: 'CAWA H Regulations (max breeding age 7)',
    vetCertAfterAgeVerified: false,
    requiresBIN: false,
    notes: 'WA: max breeding age 7 years (stricter than other states). Dogs West (CAWA) membership required.',
    sourceName: 'CAWA H Regulations + Animal Welfare Act 2002 (WA)',
    sourceUrl: 'https://www.dogswest.com',
  },
  ACT: {
    stateName: 'Australian Capital Territory',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'Dogs ACT via ANKC',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Dogs Australia rules apply via Dogs ACT.',
    sourceName: 'Dogs Australia + Animal Welfare Act 1992 (ACT)',
    sourceUrl: 'https://www.dogsact.org.au',
  },
  NT: {
    stateName: 'Northern Territory',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'Dogs NT via ANKC',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Dogs Australia rules apply via Dogs NT.',
    sourceName: 'Dogs Australia + Animal Welfare Act 1999 (NT)',
    sourceUrl: 'https://www.dogsnt.com.au',
  },
  TAS: {
    stateName: 'Tasmania',
    minBreedingMonths: 12,
    maxLifetimeLitters: 5,
    lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'KENNEL_CLUB_STATE',
    lifetimeLittersRule: 'Dogs Tasmania via ANKC',
    lifetimeLittersVerified: false,
    maxLittersIn18Months: 2,
    littersIn18mSource: 'KENNEL_CLUB_STATE',
    littersIn18mVerified: false,
    maxCsections: null,
    csectionVetRequired: null,
    vetCertAfterAgeYears: 8,
    vetCertAfterAgeSource: 'ANKC_NATIONAL',
    vetCertAfterAgeRule: 'ANKC Part 6, 8.3',
    vetCertAfterAgeVerified: true,
    requiresBIN: false,
    notes: 'Dogs Australia rules apply via Dogs Tasmania.',
    sourceName: 'Dogs Australia + Animal Welfare Act 1993 (TAS)',
    sourceUrl: 'https://www.dogstasmania.com.au',
  },
}

// ── Breed rules (Layer 1 — ANKC Part 6 breed-specific) ──────────────────────

type HealthTestKind = 'hip' | 'elbow' | 'eye_pra' | 'eye_cataract' | 'dna_jlpp' | 'dna_copper_toxicosis' | 'eye_glaucoma'

interface RequiredTest {
  kind: HealthTestKind
  appliesTo: 'both_parents' | 'dam' | 'sire'
  /** Only applies if the PARENT was born on/after this date (ISO). */
  parentBornOnOrAfter?: string
  /** Test certificate must be dated within N months prior to litter birth. */
  validityMonthsBeforeLitterBirth?: number
  /** Test must be performed after parent reached this age (months). */
  testAfterParentAgeMonths?: number
  label: string
  rule: string
}

interface BreedRules {
  /** lowercase substrings — breed matches if ALL tokens appear in normalized breed name */
  match: string[][]
  /** exclusion tokens — if any appears, this rule set does NOT apply (e.g. 'wirehaired') */
  exclude?: string[]
  minDamMonths?: number
  minDamMonthsVetExemption?: boolean       // e.g. Labrador 8.12.2
  minDamConsequence?: Consequence
  minDamRule?: string
  minSireMonths?: number
  minSireConsequence?: Consequence
  minSireRule?: string
  /** Sire rule only applies to litters BORN on/after this date. */
  minSireEffectiveLitterBornFrom?: string
  requiredTests?: RequiredTest[]
  /** merle/dapple ×-mating prohibition per 6.3.4.2 / 8.6.1 */
  prohibitedColourPairs?: { token: string; rule: string }[]
  notes?: string
}

const BREED_RULES: BreedRules[] = [
  {
    // German Shepherd Dog (both coat varieties)
    match: [['german', 'shepherd']],
    minDamMonths: 18,
    minDamConsequence: 'LIMITED_REGISTER',
    minDamRule: 'ANKC Part 6, 8.8.1',
    minSireMonths: 18,
    minSireConsequence: 'LIMITED_REGISTER',
    minSireRule: 'ANKC Part 6, 8.8.1 (applies to sire AND dam)',
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '2015-07-01', label: 'Hip Dysplasia screening (score ≤8 either hip, ≤3 any area)', rule: 'ANKC Part 6, 8.8.4(a)' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '2015-07-01', label: 'Elbow Dysplasia screening (Normal / Near Normal / Grade 1 only — Grade 2 fails)', rule: 'ANKC Part 6, 8.8.4(b)' },
    ],
    notes: 'Litters failing screening requirements → Limited Register, not to be upgraded.',
  },
  {
    // Labrador Retriever
    match: [['labrador']],
    minDamMonths: 18,
    minDamMonthsVetExemption: true,  // "unless a veterinary certificate is produced" (8.12.2)
    minDamConsequence: 'LIMITED_REGISTER',
    minDamRule: 'ANKC Part 6, 8.12.2',
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '1997-10-01', label: 'Hip Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.12.1' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '1997-10-01', label: 'Elbow Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.12.1' },
    ],
  },
  {
    // Golden Retriever
    match: [['golden', 'retriever']],
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '2002-01-01', label: 'Hip Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.13.1' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '2020-01-01', testAfterParentAgeMonths: 12, label: 'Elbow Dysplasia screening (after 12 months of age)', rule: 'ANKC Part 6, 8.13.2' },
      { kind: 'eye_pra', appliesTo: 'both_parents', parentBornOnOrAfter: '2020-01-01', validityMonthsBeforeLitterBirth: 18, label: 'PRA screening by Veterinary Ophthalmologist (within 18 months prior to litter birth)', rule: 'ANKC Part 6, 8.13.3' },
      { kind: 'eye_cataract', appliesTo: 'both_parents', parentBornOnOrAfter: '2020-01-01', validityMonthsBeforeLitterBirth: 18, label: 'Hereditary cataract screening by Veterinary Ophthalmologist (within 18 months prior to litter birth)', rule: 'ANKC Part 6, 8.13.4' },
    ],
  },
  {
    // Rottweiler
    match: [['rottweiler']],
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '1997-01-01', label: 'Hip X-ray results', rule: 'ANKC Part 6, 8.9.1' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '1997-01-01', label: 'Elbow X-ray results', rule: 'ANKC Part 6, 8.9.1' },
      { kind: 'dna_jlpp', appliesTo: 'both_parents', label: 'JLPP DNA test prior to mating — only Clear×Clear or Clear×Carrier permitted', rule: 'ANKC Part 6, 8.17.2' },
    ],
    notes: 'Natural Bobtail Rottweilers → Limited Register only (8.9.2).',
  },
  {
    // Bullmastiff
    match: [['bullmastiff']],
    minDamMonths: 18,
    minDamConsequence: 'LIMITED_REGISTER',
    minDamRule: 'ANKC Part 6, 8.14.1',
    minSireMonths: 12,
    minSireConsequence: 'LIMITED_REGISTER',
    minSireRule: 'ANKC Part 6, 8.14.4 (litters born on/after 1 Jul 2026)',
    minSireEffectiveLitterBornFrom: '2026-07-01',
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '2011-06-01', label: 'Hip Dysplasia screening', rule: 'ANKC Part 6, 8.14.2(a)' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '2011-06-01', label: 'Elbow Dysplasia screening', rule: 'ANKC Part 6, 8.14.2(b)' },
    ],
  },
  {
    // Afghan Hound
    match: [['afghan']],
    minDamMonths: 24,
    minDamMonthsVetExemption: true,  // "unless a veterinary certificate is produced" (8.16)
    minDamConsequence: 'LIMITED_REGISTER',
    minDamRule: 'ANKC Part 6, 8.16',
  },
  {
    // Bedlington Terrier
    match: [['bedlington']],
    requiredTests: [
      { kind: 'dna_copper_toxicosis', appliesTo: 'both_parents', label: 'Copper Toxicosis test (both parents) — required for Main Register eligibility', rule: 'ANKC Part 6, 8.10.1' },
    ],
  },
  {
    // Australian Shepherd
    match: [['australian', 'shepherd']],
    exclude: ['stumpy', 'cattle'],
    requiredTests: [
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '2001-07-01', label: 'Hip Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.11.1' },
    ],
  },
  {
    // Flat Coated Retriever
    match: [['flat', 'coated', 'retriever'], ['flat-coated', 'retriever']],
    requiredTests: [
      { kind: 'eye_glaucoma', appliesTo: 'both_parents', parentBornOnOrAfter: '2002-01-01', label: 'Glaucoma assessment (clear)', rule: 'ANKC Part 6, 8.15.2' },
      { kind: 'hip', appliesTo: 'both_parents', parentBornOnOrAfter: '2002-01-01', label: 'Hip Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.15.3' },
      { kind: 'elbow', appliesTo: 'both_parents', parentBornOnOrAfter: '2002-01-01', label: 'Elbow Dysplasia radiograph + assessment', rule: 'ANKC Part 6, 8.15.4' },
    ],
  },
  {
    // Border Collie — merle×merle prohibited
    match: [['border', 'collie']],
    prohibitedColourPairs: [{ token: 'merle', rule: 'ANKC Part 6, 8.6.1(a)' }],
  },
  {
    // Shetland Sheepdog — merle×merle prohibited
    match: [['shetland']],
    prohibitedColourPairs: [{ token: 'merle', rule: 'ANKC Part 6, 8.6.1(c)' }],
  },
  {
    // Dachshund (all varieties) — dapple×dapple prohibited
    match: [['dachshund']],
    prohibitedColourPairs: [{ token: 'dapple', rule: 'ANKC Part 6, 8.6.1(b)' }],
  },
]

// General merle×merle / dapple×dapple prohibition — all breeds (6.3.4.2)
const GENERAL_COLOUR_PROHIBITIONS = [
  { token: 'merle', rule: 'ANKC Part 6, 6.3.4.2' },
  { token: 'dapple', rule: 'ANKC Part 6, 6.3.4.2' },
]

// ── Health-test matching ─────────────────────────────────────────────────────
// Matches against your existing HealthTest records (testType values from the
// Health Testing tab: hip / elbow / eye / dna, plus free text from AI scan).

function testText(t: ComplianceHealthTest): string {
  const parts = [t.testType, typeof t.result === 'string' ? t.result : '', t.lab, t.certNumber]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

const KIND_MATCHERS: Record<HealthTestKind, (t: ComplianceHealthTest) => boolean> = {
  hip:                  t => /hip/.test(testText(t)),
  elbow:                t => /elbow/.test(testText(t)),
  eye_pra:              t => /pra|progressive retinal|eye/.test(testText(t)),
  eye_cataract:         t => /cataract|eye/.test(testText(t)),
  eye_glaucoma:         t => /glaucoma|eye/.test(testText(t)),
  dna_jlpp:             t => /jlpp|laryngeal/.test(testText(t)),
  dna_copper_toxicosis: t => /copper/.test(testText(t)),
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function monthsBetween(fromISO: string, to: Date): number {
  const from = new Date(fromISO)
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function normalize(s?: string): string {
  return (s || '').toLowerCase().trim()
}

// ── Breed resolution ─────────────────────────────────────────────────────────

export function findBreedRules(breed?: string): BreedRules | null {
  const b = normalize(breed)
  if (!b) return null
  for (const br of BREED_RULES) {
    if (br.exclude && br.exclude.some(x => b.includes(x))) continue
    if (br.match.some(tokens => tokens.every(tok => b.includes(tok)))) return br
  }
  return null
}

// ── Core engine ──────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<FindingLevel, number> = { ok: 0, info: 1, warn: 2, block: 3 }

export function checkBreedingCompliance(input: ComplianceInput): ComplianceResult {
  const findings: Finding[] = []
  const state = STATE_RULES[input.state || 'SA'] || STATE_RULES['SA']
  const matingDate = input.matingDate ? new Date(input.matingDate) : new Date()
  const litterBirthEstimate = addDays(matingDate, 63)
  const dam = input.dam
  const sire = input.sire
  const breedRules = findBreedRules(dam.breed)

  const damAgeMo = dam.dateOfBirth ? monthsBetween(dam.dateOfBirth, matingDate) : null
  const sireAgeMo = sire?.dateOfBirth ? monthsBetween(sire.dateOfBirth, matingDate) : null

  // ── Register eligibility (ANKC 6.6.2) ──
  const reg = normalize(dam.pedigreeRegister)
  if (['no_pedigree', 'mixed', 'rescue'].includes(reg)) {
    findings.push({
      level: 'info', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: 'No Dogs Australia pedigree — litters cannot be registered with Dogs Australia',
      rule: 'ANKC Part 6, 6.6.1', verified: true,
    })
  } else if (reg === 'limited') {
    findings.push({
      level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: 'Limited Register — not eligible to breed under Dogs Australia rules',
      rule: 'ANKC Part 6, 6.6.2(ii)', verified: true,
    })
  }
  if (sire && normalize(sire.pedigreeRegister) === 'limited') {
    findings.push({
      level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: `Sire${sire.name ? ` (${sire.name})` : ''} is on the Limited Register — not eligible for breeding`,
      rule: 'ANKC Part 6, 6.6.2(ii)', verified: true,
    })
  }

  // ── Dam minimum age ──
  if (damAgeMo !== null) {
    if (damAgeMo < state.minBreedingMonths) {
      findings.push({
        level: 'block', source: 'ANKC_NATIONAL', consequence: 'LIMITED_REGISTER',
        message: `Dam is ${damAgeMo} months — under national minimum of ${state.minBreedingMonths} months`,
        rule: 'ANKC Part 6, 8.2', verified: true,
      })
    } else if (breedRules?.minDamMonths && damAgeMo < breedRules.minDamMonths) {
      const exemption = breedRules.minDamMonthsVetExemption
      findings.push({
        level: exemption ? 'warn' : 'block',
        source: 'ANKC_NATIONAL',
        consequence: exemption ? 'VET_CERT_REQUIRED' : (breedRules.minDamConsequence || 'LIMITED_REGISTER'),
        message: exemption
          ? `Dam is ${damAgeMo} months — breed minimum is ${breedRules.minDamMonths} months. Litter → Limited Register unless a veterinary certificate (health grounds) is produced`
          : `Dam is ${damAgeMo} months — breed minimum is ${breedRules.minDamMonths} months. Litter → Limited Register, not to be upgraded`,
        rule: breedRules.minDamRule || 'ANKC Part 6', verified: true,
      })
    }
  }

  // ── Sire minimum age (GSD, Bullmastiff) ──
  if (sire && sireAgeMo !== null && breedRules?.minSireMonths) {
    const effective = !breedRules.minSireEffectiveLitterBornFrom
      || litterBirthEstimate >= new Date(breedRules.minSireEffectiveLitterBornFrom)
    if (effective && sireAgeMo < breedRules.minSireMonths) {
      findings.push({
        level: 'block', source: 'ANKC_NATIONAL',
        consequence: breedRules.minSireConsequence || 'LIMITED_REGISTER',
        message: `Sire${sire.name ? ` (${sire.name})` : ''} is ${sireAgeMo} months — breed minimum for stud is ${breedRules.minSireMonths} months. Litter → Limited Register, not to be upgraded`,
        rule: breedRules.minSireRule || 'ANKC Part 6', verified: true,
      })
    }
  }

  // ── Dam upper age → vet certificate ──
  if (damAgeMo !== null && damAgeMo >= state.vetCertAfterAgeYears * 12) {
    findings.push({
      level: 'warn', source: state.vetCertAfterAgeSource, consequence: 'VET_CERT_REQUIRED',
      message: `Dam is ${Math.floor(damAgeMo / 12)} years — veterinary certificate of fitness required, dated within 3 months prior to mating`,
      rule: state.vetCertAfterAgeRule, verified: state.vetCertAfterAgeVerified,
    })
  }

  // ── Lifetime litters (vet-cert exemption where the law provides one) ──
  const litters = dam.litterCount ?? 0
  if (litters >= state.maxLifetimeLitters) {
    if (state.lifetimeLittersVetExemption) {
      findings.push({
        level: 'warn', source: state.lifetimeLittersSource, consequence: 'VET_CERT_REQUIRED',
        message: `Dam has had ${litters} litters (limit ${state.maxLifetimeLitters}) — further litters require a written veterinary certificate that she is fit to breed`,
        rule: state.lifetimeLittersRule, verified: state.lifetimeLittersVerified,
      })
    } else {
      findings.push({
        level: 'block', source: state.lifetimeLittersSource, consequence: 'LEGAL_OFFENCE',
        message: `Lifetime litter limit reached (${state.maxLifetimeLitters} max in ${state.stateName})`,
        rule: state.lifetimeLittersRule, verified: state.lifetimeLittersVerified,
      })
    }
  }

  // ── Litter frequency ──
  if (state.maxLittersIn18Months !== 999 && (dam.last18mLitters ?? 0) >= state.maxLittersIn18Months) {
    findings.push({
      level: 'warn', source: state.littersIn18mSource, consequence: 'ETHICS_BREACH',
      message: `${dam.last18mLitters} litters in the last 18 months (limit ${state.maxLittersIn18Months})${state.littersIn18mVerified ? '' : ' — source pending verification (Dogs SA Code of Ethics)'}`,
      rule: `${state.sourceName}`, verified: state.littersIn18mVerified,
    })
  }

  // ── C-sections (NSW) ──
  const cs = dam.cSectionCount ?? 0
  if (state.maxCsections !== null && cs >= state.maxCsections) {
    findings.push({
      level: 'block', source: 'STATE_LAW', consequence: 'LEGAL_OFFENCE',
      message: `C-section limit reached (${state.maxCsections} max in ${state.stateName})`,
      rule: state.sourceName, verified: false,
    })
  } else if (state.csectionVetRequired !== null && cs >= state.csectionVetRequired) {
    findings.push({
      level: 'warn', source: 'STATE_LAW', consequence: 'VET_CERT_REQUIRED',
      message: 'Veterinary certificate required before next C-section pregnancy',
      rule: state.sourceName, verified: false,
    })
  }

  // ── Colour prohibitions (merle×merle / dapple×dapple) ──
  if (sire) {
    const damColour = normalize(dam.colour)
    const sireColour = normalize(sire.colour)
    const pairs = [...(breedRules?.prohibitedColourPairs || []), ...GENERAL_COLOUR_PROHIBITIONS]
    const seen = new Set<string>()
    for (const p of pairs) {
      if (seen.has(p.token)) continue
      seen.add(p.token)
      if (damColour.includes(p.token) && sireColour.includes(p.token)) {
        findings.push({
          level: 'block', source: 'ANKC_NATIONAL', consequence: 'LIMITED_REGISTER',
          message: `${p.token.charAt(0).toUpperCase() + p.token.slice(1)}-to-${p.token} mating prohibited (health risk: hearing/sight defects). Progeny → Limited Register, never to be upgraded`,
          rule: p.rule, verified: true,
        })
      }
    }
  }

  // ── Breed health-test prerequisites ──
  if (breedRules?.requiredTests) {
    const parents: { role: 'dam' | 'sire'; dog: ComplianceDog; tests: ComplianceHealthTest[] }[] = [
      { role: 'dam', dog: dam, tests: input.damHealthTests || [] },
    ]
    if (sire) parents.push({ role: 'sire', dog: sire, tests: input.sireHealthTests || [] })

    for (const req of breedRules.requiredTests) {
      for (const p of parents) {
        if (req.appliesTo !== 'both_parents' && req.appliesTo !== p.role) continue
        // Date gate: rule only applies if parent born on/after cutoff
        if (req.parentBornOnOrAfter && p.dog.dateOfBirth
            && new Date(p.dog.dateOfBirth) < new Date(req.parentBornOnOrAfter)) continue

        const matches = p.tests.filter(KIND_MATCHERS[req.kind])
        const roleLabel = p.role === 'dam' ? 'Dam' : `Sire${p.dog.name ? ` (${p.dog.name})` : ''}`

        if (matches.length === 0) {
          findings.push({
            level: 'warn', source: 'ANKC_NATIONAL', consequence: 'LIMITED_REGISTER',
            message: `${roleLabel}: no ${req.label} on record — required before litter registration`,
            rule: req.rule, verified: true,
          })
          continue
        }

        // Validity window (e.g. Golden eye exams: within 18 months of litter birth)
        if (req.validityMonthsBeforeLitterBirth) {
          const validFrom = new Date(litterBirthEstimate)
          validFrom.setMonth(validFrom.getMonth() - req.validityMonthsBeforeLitterBirth)
          const current = matches.some(t => t.dateTested && new Date(t.dateTested) >= validFrom)
          if (!current) {
            const latest = matches
              .map(t => t.dateTested).filter(Boolean).sort().pop()
            findings.push({
              level: 'warn', source: 'ANKC_NATIONAL', consequence: 'LIMITED_REGISTER',
              message: `${roleLabel}: ${req.label} — latest certificate${latest ? ` (${latest})` : ''} will be outside the ${req.validityMonthsBeforeLitterBirth}-month window at estimated whelping (${litterBirthEstimate.toISOString().split('T')[0]}). Re-test required`,
              rule: req.rule, verified: true,
            })
          }
        }

        // Test-after-age gate (e.g. Golden elbows after 12 months)
        if (req.testAfterParentAgeMonths && p.dog.dateOfBirth) {
          const validTest = matches.some(t =>
            t.dateTested && monthsBetween(p.dog.dateOfBirth!, new Date(t.dateTested)) >= req.testAfterParentAgeMonths!)
          if (!validTest) {
            findings.push({
              level: 'warn', source: 'ANKC_NATIONAL', consequence: 'LIMITED_REGISTER',
              message: `${roleLabel}: ${req.label} — existing test was taken before ${req.testAfterParentAgeMonths} months of age; a compliant re-test is required`,
              rule: req.rule, verified: true,
            })
          }
        }
      }
    }
  }

  // ── SA legal reminders (informational, not computable from data) ──
  if ((input.state || 'SA') === 'SA' && findings.every(f => f.level !== 'block')) {
    findings.push({
      level: 'info', source: 'STATE_LAW', consequence: 'INFO',
      message: 'SA law: dogs must be physically/mentally fit and disease-free at mating; matings with high probability of serious hereditary defect are prohibited without ethics committee approval',
      rule: 'SA S&G 2017, Std 10.1.1.4, 10.1.1.7', verified: true,
    })
  }

  // ── Overall ──
  const overall = findings.reduce<FindingLevel>(
    (worst, f) => (LEVEL_RANK[f.level] > LEVEL_RANK[worst] ? f.level : worst), 'ok')

  const firstBlock = findings.find(f => f.level === 'block')
  const firstWarn = findings.find(f => f.level === 'warn')
  const headline =
    overall === 'block' ? `❌ ${firstBlock!.message}`
    : overall === 'warn' ? `⚠️ ${firstWarn!.message}`
    : '✓ Currently eligible to breed'

  return { overall, headline, findings }
}

// ── Convenience: dam-only summary (drop-in for current BreedingTab badge) ────

// Puppies/whelps are not breeding candidates yet — excluded before any rule
// runs, not flagged as a compliance warning. Stage is derived fresh via the
// single breed-aware age source (calculateLifeStage), never a stored field.
export function checkDamCompliance(
  dam: ComplianceDog,
  damHealthTests: ComplianceHealthTest[],
  state: string,
): ComplianceResult {
  const stage = calculateLifeStage(dam.dateOfBirth || '', dam.breed)
  if (stage === 'whelp' || stage === 'puppy') {
    return { overall: 'not_yet', headline: 'Not yet of breeding age', findings: [] }
  }
  return checkBreedingCompliance({ dam, damHealthTests, state })
}
