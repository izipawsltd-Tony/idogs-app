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
import { differenceInMonths } from 'date-fns'

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
  pedigreeRegister?: string        // 'main' | 'limited' | 'not_recorded' | 'no_pedigree' | 'mixed' | 'rescue'
  breedingEligibility?: string     // 'eligible' | 'not_eligible' | 'unknown'
  litterCount?: number
  last18mLitters?: number
  cSectionCount?: number
  lastLitterDate?: string
}

// ── Pedigree register / breeding eligibility (canonical resolvers) ─────────
//
// A dog's Firestore `pedigreeRegister` field is missing/undefined for every
// litter-born puppy (there is no field to set it at puppy-creation time) and
// for any legacy record predating the field. Several call sites used to
// treat that as `pedigreeRegister || 'main'`, which silently turned "we
// never recorded this" into "Main Register — eligible to breed" — exactly
// the transferred-puppy bug this module now guards against. NOT_RECORDED is
// its own state, distinct from MAIN, and must never be upgraded to MAIN by
// a fallback default.
//
// Pedigree/registration and breeding eligibility are deliberately separate
// concepts: MAIN does not imply ELIGIBLE. Eligibility is only ever ELIGIBLE
// when explicitly confirmed (`breedingEligibility === 'eligible'`); absent
// that, MAIN reads as UNKNOWN ("not confirmed"), never as an assumed pass.

export type PedigreeRegisterStatus = 'MAIN' | 'LIMITED' | 'NOT_RECORDED' | 'NO_PEDIGREE' | 'MIXED' | 'RESCUE'
export type BreedingEligibilityStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'UNKNOWN'
export type BreedingRightsValue = 'eligible' | 'not_eligible' | 'unknown'

export type AustralianJurisdiction = 'SA' | 'NSW' | 'VIC' | 'QLD' | 'WA' | 'TAS' | 'ACT' | 'NT'

const AUSTRALIAN_JURISDICTIONS = new Set<AustralianJurisdiction>(['SA', 'NSW', 'VIC', 'QLD', 'WA', 'TAS', 'ACT', 'NT'])

/**
 * Fail-closed jurisdiction resolver. Missing/invalid profile state is NEVER
 * coerced to South Australia. Callers must surface that the jurisdiction
 * is not set instead of applying the wrong state's law.
 */
export function resolveComplianceJurisdiction(raw?: string | null): AustralianJurisdiction | null {
  const normalized = String(raw || '').trim().toUpperCase() as AustralianJurisdiction
  return AUSTRALIAN_JURISDICTIONS.has(normalized) ? normalized : null
}

export function resolvePedigreeRegister(raw?: string): PedigreeRegisterStatus {
  switch (raw) {
    case 'main': return 'MAIN'
    case 'limited': return 'LIMITED'
    case 'no_pedigree': return 'NO_PEDIGREE'
    case 'mixed': return 'MIXED'
    case 'rescue': return 'RESCUE'
    // undefined, '', 'not_recorded', or any unrecognised legacy value —
    // all fail closed to NOT_RECORDED, never to MAIN.
    default: return 'NOT_RECORDED'
  }
}

/**
 * Single source of truth for "is this dog eligible to breed", independent
 * of any other age/health/litter-frequency compliance finding.
 *   LIMITED                        → always NOT_ELIGIBLE (never overridable)
 *   MAIN                           → explicit breedingEligibility if set, else UNKNOWN
 *   NOT_RECORDED / NO_PEDIGREE /
 *   MIXED / RESCUE                 → always UNKNOWN (nothing authoritative to read)
 */
export function resolveBreedingEligibility(dog: { pedigreeRegister?: string; breedingEligibility?: string }): BreedingEligibilityStatus {
  const register = resolvePedigreeRegister(dog.pedigreeRegister)
  if (register === 'LIMITED') return 'NOT_ELIGIBLE'
  if (register !== 'MAIN') return 'UNKNOWN'
  if (dog.breedingEligibility === 'eligible') return 'ELIGIBLE'
  if (dog.breedingEligibility === 'not_eligible') return 'NOT_ELIGIBLE'
  return 'UNKNOWN'
}


/**
 * UI/storage adapter for the explicit breeder-controlled layer between
 * pedigree registration and actual compliance. We keep the existing
 * Firestore field name `breedingEligibility` for backwards compatibility,
 * but user-facing copy calls it "Breeding rights" so it cannot be confused
 * with the final compliance result.
 */
export function initialBreedingRightsValue(
  dog: { pedigreeRegister?: string; breedingEligibility?: string },
): BreedingRightsValue {
  const status = resolveBreedingEligibility(dog)
  if (status === 'ELIGIBLE') return 'eligible'
  if (status === 'NOT_ELIGIBLE') return 'not_eligible'
  return 'unknown'
}

export function breedingRightsLabel(value: BreedingRightsValue | BreedingEligibilityStatus): string {
  switch (value) {
    case 'eligible':
    case 'ELIGIBLE':
      return 'Breeding permitted'
    case 'not_eligible':
    case 'NOT_ELIGIBLE':
      return 'Not permitted'
    default:
      return 'Not confirmed'
  }
}

/**
 * Canonical write rule for the Breeding rights control.
 * - LIMITED always forces not_eligible.
 * - MAIN may be explicitly confirmed as permitted, not permitted, or unknown.
 * - Any other registration state cannot be promoted to permitted through the
 *   rights control; it resolves to unknown until registration is authoritative.
 */
export function nextBreedingRightsUpdate(
  pedigreeRegisterRaw: string | undefined,
  nextRightsRaw: BreedingRightsValue,
): { breedingEligibility: BreedingRightsValue } {
  const register = resolvePedigreeRegister(pedigreeRegisterRaw)
  if (register === 'LIMITED') return { breedingEligibility: 'not_eligible' }
  if (register !== 'MAIN') return { breedingEligibility: 'unknown' }
  return { breedingEligibility: nextRightsRaw }
}

/**
 * Canonical patch to write whenever a user sets pedigree/registration —
 * the DogDetailPage edit control AND both ownership-transfer modals share
 * this single implementation so the rule can never drift between them.
 *   Rule 6: anything → LIMITED forces breedingEligibility to 'not_eligible'
 *           (LIMITED can never be eligible).
 *   Rule (NOT_RECORDED/NO_PEDIGREE/MIXED/RESCUE): none of these are ever
 *           authoritative for eligibility, so breedingEligibility is forced
 *           to 'unknown' — mirrors resolveBreedingEligibility's own logic,
 *           so the write and the read can never disagree.
 *   Rule 7: LIMITED → MAIN must NOT resurrect an assumed 'eligible' — the
 *           'not_eligible' that LIMITED forced was never authoritative data
 *           for MAIN, so it resets to 'unknown' rather than being carried
 *           over.
 *   Otherwise (staying on/arriving at MAIN from a non-limited state):
 *           breedingEligibility is left untouched, preserving any existing
 *           explicit value.
 */
export function nextPedigreeRegisterUpdate(
  currentRaw: string | undefined,
  nextRegisterRaw: string,
): { pedigreeRegister: string; breedingEligibility?: 'eligible' | 'not_eligible' | 'unknown' } {
  const wasLimited = resolvePedigreeRegister(currentRaw) === 'LIMITED'
  const nextRegister = resolvePedigreeRegister(nextRegisterRaw)
  const update: { pedigreeRegister: string; breedingEligibility?: 'eligible' | 'not_eligible' | 'unknown' } = { pedigreeRegister: nextRegisterRaw }
  if (nextRegister === 'LIMITED') {
    update.breedingEligibility = 'not_eligible'
  } else if (nextRegister !== 'MAIN') {
    update.breedingEligibility = 'unknown'
  } else if (wasLimited) {
    update.breedingEligibility = 'unknown'
  }
  return update
}

/**
 * Normalizes a dog's raw pedigreeRegister for prefilling an ownership-
 * transfer modal's Pedigree / Registration control. Transfer must NEVER
 * reclassify an existing valid value just because the breeder didn't touch
 * the control — every one of the six values the Dog model supports round-
 * trips as itself. Only a genuinely missing/undefined/unrecognised value
 * (a litter-born puppy that's never had this field set at all) falls back
 * to 'not_recorded'. Shared by both transfer flows (LittersPage.tsx and
 * DogDetailPage.tsx) so the prefill rule can't drift between them.
 */
export function initialTransferPedigreeRegister(
  raw?: string,
): 'main' | 'limited' | 'not_recorded' | 'no_pedigree' | 'mixed' | 'rescue' {
  switch (raw) {
    case 'main':
    case 'limited':
    case 'not_recorded':
    case 'no_pedigree':
    case 'mixed':
    case 'rescue':
      return raw
    default:
      return 'not_recorded'
  }
}

/**
 * Short plain-text label for a pedigreeRegister value, for use anywhere the
 * UI needs to name the value in prose (e.g. a transfer confirmation
 * checkbox) rather than render it as a standalone badge. Single source so
 * that label text can't drift from resolvePedigreeRegister's own states.
 */
export function pedigreeRegisterLabel(raw?: string): string {
  switch (resolvePedigreeRegister(raw)) {
    case 'MAIN': return 'Main Register'
    case 'LIMITED': return 'Limited Register'
    case 'NO_PEDIGREE': return 'No pedigree'
    case 'MIXED': return 'Mixed breed'
    case 'RESCUE': return 'Rescue / unknown'
    case 'NOT_RECORDED': return 'Not recorded'
  }
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
  /** State/territory code. Missing/invalid values fail closed; there is no SA fallback. */
  state?: string
  /** Apply state kennel-club/member-body ethics rules only when membership is actually known. */
  applyMemberBodyRules?: boolean
  /** Proposed mating date (ISO). Defaults to today. Whelping estimated +63 days. */
  matingDate?: string
}

// ── State rules (Layer 2 + 3) ────────────────────────────────────────────────

export interface StateRules {
  stateName: string
  minBreedingMonths: number
  minBreedingMonthsLarge: number
  minBreedingSource: RuleSource
  minBreedingRule: string
  minBreedingVerified: boolean
  /** 999 = no verified universal state/territory cap encoded. */
  maxLifetimeLitters: number
  lifetimeLittersVetExemption: boolean
  lifetimeLittersSource: RuleSource
  lifetimeLittersRule: string
  lifetimeLittersVerified: boolean
  /** 999 = no verified universal rule encoded. */
  maxLittersIn18Months: number
  littersIn18mSource: RuleSource
  littersIn18mVerified: boolean
  maxCsections: number | null
  csectionVetRequired: number | null
  csectionRule: string
  csectionVerified: boolean
  /** Review/vet-certificate threshold, from local law or Dogs Australia rules. */
  maxAgeYears: number
  vetCertAfterAgeYears: number
  vetCertAfterAgeSource: RuleSource
  vetCertAfterAgeRule: string
  vetCertAfterAgeVerified: boolean
  requiresBIN: boolean
  breederIdLabel: string | null
  breederIdVerified: boolean
  memberBodyName: string
  memberBodyUrl: string
  memberRulesVerified: boolean
  notes: string
  sourceName: string
  sourceUrl: string
}

export const STATE_RULES: Record<AustralianJurisdiction, StateRules> = {
  SA: {
    stateName: 'South Australia',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6', minBreedingVerified: true,
    maxLifetimeLitters: 5, lifetimeLittersVetExemption: true,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'SA Standards & Guidelines 2017, Std 10.1.1.1', lifetimeLittersVerified: true,
    maxLittersIn18Months: 2, littersIn18mSource: 'KENNEL_CLUB_STATE', littersIn18mVerified: false,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No verified universal SA C-section cap encoded', csectionVerified: false,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: 'DACO breeder registration; new breeder licensing scheme expected in 2027', breederIdVerified: true,
    memberBodyName: 'Dogs SA', memberBodyUrl: 'https://www.dogssa.com.au/', memberRulesVerified: false,
    notes: 'Current SA welfare standards apply now. The newer breeder licensing scheme is expected in 2027 and is not treated as current law.',
    sourceName: 'SA Department for Environment and Water — current animal-welfare framework',
    sourceUrl: 'https://www.environment.sa.gov.au/topics/animals-and-plants/animal-welfare',
  },
  NSW: {
    stateName: 'New South Wales',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6', minBreedingVerified: true,
    maxLifetimeLitters: 5, lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'NSW dog breeding reforms effective 1 Dec 2025', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: 3, csectionVetRequired: 2, csectionRule: 'NSW dog breeding reforms effective 1 Dec 2025', csectionVerified: true,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: true, breederIdLabel: 'NSW Breeder Identification Number (BIN)', breederIdVerified: true,
    memberBodyName: 'DOGS NSW', memberBodyUrl: 'https://www.dogsnsw.org.au/', memberRulesVerified: false,
    notes: 'BIN is mandatory from 1 Dec 2025. Female dogs are limited to 5 lifetime litters or up to 3 caesarean litters with veterinarian approval, whichever occurs first.',
    sourceName: 'NSW Office of Local Government — Changes to dog breeding laws',
    sourceUrl: 'https://www.olg.nsw.gov.au/pets/nsw-pet-registry/breeders/changes-dog-breeding-laws',
  },
  VIC: {
    stateName: 'Victoria',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'STATE_LAW', minBreedingRule: 'Victorian Code of Practice for the Private Keeping of Dogs — breeding and reproduction', minBreedingVerified: true,
    maxLifetimeLitters: 999, lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'No verified universal lifetime cap encoded for all Victorian breeders', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No verified universal Victorian C-section cap encoded', csectionVerified: false,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: 'Pet Exchange Register source number (where required)', breederIdVerified: true,
    memberBodyName: 'Dogs Victoria', memberBodyUrl: 'https://dogsvictoria.org.au/', memberRulesVerified: false,
    notes: 'Victorian law sets a 12-month minimum for breeding females. Business/recreational-breeder obligations vary by breeder category; Dogs Victoria member rules are not treated as state law.',
    sourceName: 'Animal Welfare Victoria — Code of Practice for the Private Keeping of Dogs',
    sourceUrl: 'https://agriculture.vic.gov.au/livestock-and-animals/animal-welfare-victoria/pocta-act-1986/victorian-codes-of-practice-for-animal-welfare/code-of-practice-for-the-private-keeping-of-dogs',
  },
  QLD: {
    stateName: 'Queensland',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6; Queensland law separately requires physical maturity and fitness', minBreedingVerified: true,
    maxLifetimeLitters: 999, lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'No verified universal lifetime cap encoded in Queensland Schedule 7', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No verified universal Queensland C-section cap encoded', csectionVerified: false,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: 'Queensland dog breeder supply number', breederIdVerified: true,
    memberBodyName: 'Dogs Queensland', memberBodyUrl: 'https://dogsqueensland.org.au/', memberRulesVerified: false,
    notes: 'Queensland Schedule 7 requires a breeding female to be physically mature, fit and healthy, prohibits close-relative mating, and restricts breeding dogs with deleterious heritable conditions without written professional approval.',
    sourceName: 'Queensland Animal Care and Protection Regulation 2023 — Schedule 7',
    sourceUrl: 'https://www.legislation.qld.gov.au/view/whole/html/inforce/current/sl-2023-0117',
  },
  WA: {
    stateName: 'Western Australia',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6', minBreedingVerified: true,
    maxLifetimeLitters: 999, lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'No verified universal current lifetime cap encoded', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No verified universal WA C-section cap encoded', csectionVerified: false,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: null, breederIdVerified: true,
    memberBodyName: 'Dogs West', memberBodyUrl: 'https://www.dogswest.com/', memberRulesVerified: false,
    notes: 'WA approval-to-breed / stop-puppy-farming provisions are legislated but government guidance still states they apply when the laws commence. iDogs does not treat those future provisions as current hard blocks.',
    sourceName: 'WA Government — Stop puppy farming',
    sourceUrl: 'https://www.wa.gov.au/organisation/local-government/stop-puppy-farming',
  },
  TAS: {
    stateName: 'Tasmania',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6; Tasmanian law additionally prohibits mating before first oestrus', minBreedingVerified: true,
    maxLifetimeLitters: 5, lifetimeLittersVetExemption: true,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'Animal Welfare (Dogs) Regulations 2026, reg 23(3)', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No specific universal C-section cap encoded in reg 23', csectionVerified: true,
    maxAgeYears: 7, vetCertAfterAgeYears: 7, vetCertAfterAgeSource: 'STATE_LAW', vetCertAfterAgeRule: 'Animal Welfare (Dogs) Regulations 2026, reg 23(4)', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: null, breederIdVerified: true,
    memberBodyName: 'Dogs Tasmania', memberBodyUrl: 'https://www.dogstasmania.com.au/', memberRulesVerified: false,
    notes: 'Tasmania prohibits mating before first oestrus, caps a bitch at 5 lifetime litters unless a vet makes a written determination, and requires a written vet determination to breed after age 7.',
    sourceName: 'Tasmanian Legislation — Animal Welfare (Dogs) Regulations 2026',
    sourceUrl: 'https://www.legislation.tas.gov.au/view/whole/html/inforce/current/sr-2026-061',
  },
  ACT: {
    stateName: 'Australian Capital Territory',
    minBreedingMonths: 18, minBreedingMonthsLarge: 18,
    minBreedingSource: 'STATE_LAW', minBreedingRule: 'ACT Breeding Standard, cl 2', minBreedingVerified: true,
    maxLifetimeLitters: 4, lifetimeLittersVetExemption: true,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'ACT Breeding Standard — no more than 4 lifetime litters unless written vet approval applies', lifetimeLittersVerified: true,
    maxLittersIn18Months: 1, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: 1, csectionRule: 'ACT Breeding Standard — previous caesarean birth requires review; written-vet-approval exception applies', csectionVerified: true,
    maxAgeYears: 6, vetCertAfterAgeYears: 6, vetCertAfterAgeSource: 'STATE_LAW', vetCertAfterAgeRule: 'ACT Breeding Standard, cl 2 (18 months to 6 years; written vet approval exception)', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: 'ACT breeder licence / breeding-standard obligations', breederIdVerified: true,
    memberBodyName: 'Dogs ACT', memberBodyUrl: 'https://www.dogsact.org.au/', memberRulesVerified: false,
    notes: 'ACT breeding standard: ordinarily 18 months to 6 years, no more than once in 18 months, no more than 4 lifetime litters; written veterinary approval can provide an exception.',
    sourceName: 'ACT Legislation Register — Breeding Standard (DI2015-257)',
    sourceUrl: 'https://www.legislation.act.gov.au/di/2015-257/',
  },
  NT: {
    stateName: 'Northern Territory',
    minBreedingMonths: 12, minBreedingMonthsLarge: 18,
    minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6', minBreedingVerified: true,
    maxLifetimeLitters: 999, lifetimeLittersVetExemption: false,
    lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'No breeder-specific universal lifetime cap verified in current NT animal-protection sources', lifetimeLittersVerified: true,
    maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: true,
    maxCsections: null, csectionVetRequired: null, csectionRule: 'No breeder-specific universal NT C-section cap verified', csectionVerified: true,
    maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
    requiresBIN: false, breederIdLabel: null, breederIdVerified: true,
    memberBodyName: 'Dogs NT', memberBodyUrl: 'https://www.dogsnt.com.au/', memberRulesVerified: false,
    notes: 'Current NT sources establish general animal-protection duties but iDogs has not verified a breeder-specific universal numeric litter or C-section cap. No such cap is invented.',
    sourceName: 'Northern Territory Government — Animal protection laws',
    sourceUrl: 'https://nt.gov.au/environment/animals/animal-welfare',
  },
}

/** Neutral ruleset used when profile jurisdiction is missing. It keeps Dogs
 * Australia national guidance available but applies no local numeric cap. */
export const NO_JURISDICTION_RULES: StateRules = {
  stateName: 'Jurisdiction not set',
  minBreedingMonths: 12, minBreedingMonthsLarge: 18,
  minBreedingSource: 'ANKC_NATIONAL', minBreedingRule: 'Dogs Australia Regulations Part 6', minBreedingVerified: true,
  maxLifetimeLitters: 999, lifetimeLittersVetExemption: false,
  lifetimeLittersSource: 'STATE_LAW', lifetimeLittersRule: 'Set breeder state/territory to evaluate local law', lifetimeLittersVerified: false,
  maxLittersIn18Months: 999, littersIn18mSource: 'STATE_LAW', littersIn18mVerified: false,
  maxCsections: null, csectionVetRequired: null, csectionRule: 'Set breeder state/territory to evaluate local law', csectionVerified: false,
  maxAgeYears: 8, vetCertAfterAgeYears: 8, vetCertAfterAgeSource: 'ANKC_NATIONAL', vetCertAfterAgeRule: 'Dogs Australia Part 6, 8.3', vetCertAfterAgeVerified: true,
  requiresBIN: false, breederIdLabel: null, breederIdVerified: false,
  memberBodyName: 'State member body not determined', memberBodyUrl: '', memberRulesVerified: false,
  notes: 'Set the breeder profile state/territory before relying on state-law compliance results.',
  sourceName: 'Jurisdiction required', sourceUrl: '',
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
  return differenceInMonths(to, new Date(fromISO))
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
  const jurisdiction = resolveComplianceJurisdiction(input.state)
  const state = jurisdiction ? STATE_RULES[jurisdiction] : NO_JURISDICTION_RULES
  if (!jurisdiction) {
    findings.push({ level: 'warn', source: 'STATE_LAW', consequence: 'INFO', message: 'Compliance jurisdiction not set — set breeder state/territory before relying on state-law checks', rule: 'Jurisdiction required', verified: true })
  }
  const matingDate = input.matingDate ? new Date(input.matingDate) : new Date()
  const litterBirthEstimate = addDays(matingDate, 63)
  const dam = input.dam
  const sire = input.sire
  const breedRules = findBreedRules(dam.breed)

  const damAgeMo = dam.dateOfBirth ? monthsBetween(dam.dateOfBirth, matingDate) : null
  const sireAgeMo = sire?.dateOfBirth ? monthsBetween(sire.dateOfBirth, matingDate) : null

  // ── Register eligibility (ANKC 6.6.2) ──
  // Uses the canonical resolvers so a missing/undefined pedigreeRegister
  // (every litter-born puppy, until someone edits it) resolves to
  // NOT_RECORDED rather than silently falling through as MAIN + eligible.
  const damRegister = resolvePedigreeRegister(dam.pedigreeRegister)
  if (damRegister === 'NO_PEDIGREE' || damRegister === 'MIXED' || damRegister === 'RESCUE') {
    findings.push({
      level: 'info', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: 'No Dogs Australia pedigree — litters cannot be registered with Dogs Australia',
      rule: 'ANKC Part 6, 6.6.1', verified: true,
    })
  } else if (damRegister === 'LIMITED') {
    findings.push({
      level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: 'Limited Register — breeding rights do not permit breeding',
      rule: 'ANKC Part 6, 6.6.2(ii)', verified: true,
    })
  } else if (damRegister === 'NOT_RECORDED') {
    findings.push({
      level: 'warn', source: 'ANKC_NATIONAL', consequence: 'INFO',
      message: 'Registration not recorded — breeding rights not confirmed',
      rule: 'ANKC Part 6, 6.6.2', verified: true,
    })
  } else if (damRegister === 'MAIN' && resolveBreedingEligibility(dam) === 'UNKNOWN') {
    findings.push({
      level: 'warn', source: 'ANKC_NATIONAL', consequence: 'INFO',
      message: 'Main Register — breeding rights not confirmed',
      rule: 'ANKC Part 6, 6.6.2', verified: true,
    })
  } else if (damRegister === 'MAIN' && resolveBreedingEligibility(dam) === 'NOT_ELIGIBLE') {
    findings.push({
      level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
      message: 'Breeding rights marked not permitted',
      rule: 'ANKC Part 6, 6.6.2', verified: true,
    })
  }
  if (sire) {
    const sireRegister = resolvePedigreeRegister(sire.pedigreeRegister)
    if (sireRegister === 'LIMITED') {
      findings.push({
        level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
        message: `Sire${sire.name ? ` (${sire.name})` : ''} is on the Limited Register — breeding rights do not permit breeding`,
        rule: 'ANKC Part 6, 6.6.2(ii)', verified: true,
      })
    } else if (sireRegister === 'NOT_RECORDED') {
      findings.push({
        level: 'warn', source: 'ANKC_NATIONAL', consequence: 'INFO',
        message: `Sire${sire.name ? ` (${sire.name})` : ''}: registration not recorded — breeding rights not confirmed`,
        rule: 'ANKC Part 6, 6.6.2', verified: true,
      })
    } else if (sireRegister === 'MAIN' && resolveBreedingEligibility(sire) === 'UNKNOWN') {
      findings.push({
        level: 'warn', source: 'ANKC_NATIONAL', consequence: 'INFO',
        message: `Sire${sire.name ? ` (${sire.name})` : ''}: Main Register — breeding rights not confirmed`,
        rule: 'ANKC Part 6, 6.6.2', verified: true,
      })
    } else if (sireRegister === 'MAIN' && resolveBreedingEligibility(sire) === 'NOT_ELIGIBLE') {
      findings.push({
        level: 'block', source: 'ANKC_NATIONAL', consequence: 'LITTER_NOT_REGISTRABLE',
        message: `Sire${sire.name ? ` (${sire.name})` : ''} has breeding rights marked not permitted`,
        rule: 'ANKC Part 6, 6.6.2', verified: true,
      })
    }
  }

  // ── Dam minimum age ──
  if (damAgeMo !== null) {
    if (damAgeMo < state.minBreedingMonths) {
      findings.push({
        level: 'block', source: state.minBreedingSource,
        consequence: state.minBreedingSource === 'STATE_LAW' ? 'LEGAL_OFFENCE' : 'LIMITED_REGISTER',
        message: `Dam is ${damAgeMo} months — minimum encoded for ${jurisdiction ? state.stateName : 'Dogs Australia national rules'} is ${state.minBreedingMonths} months`,
        rule: state.minBreedingRule, verified: state.minBreedingVerified,
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

  // ── Lifetime litters (only when a universal cap is encoded) ──
  const litters = dam.litterCount ?? 0
  if (state.maxLifetimeLitters !== 999 && litters >= state.maxLifetimeLitters) {
    if (state.lifetimeLittersVetExemption) {
      findings.push({
        level: 'warn', source: state.lifetimeLittersSource, consequence: 'VET_CERT_REQUIRED',
        message: `Dam has had ${litters} litters (threshold ${state.maxLifetimeLitters}) — further breeding requires the applicable written veterinary approval/determination`,
        rule: state.lifetimeLittersRule, verified: state.lifetimeLittersVerified,
      })
    } else {
      findings.push({
        level: state.lifetimeLittersVerified ? 'block' : 'warn', source: state.lifetimeLittersSource,
        consequence: state.lifetimeLittersVerified ? 'LEGAL_OFFENCE' : 'INFO',
        message: `Lifetime litter threshold reached (${state.maxLifetimeLitters} in ${state.stateName})${state.lifetimeLittersVerified ? '' : ' — source pending verification'}`,
        rule: state.lifetimeLittersRule, verified: state.lifetimeLittersVerified,
      })
    }
  }

  // ── Litter frequency ──
  const applyFrequencyRule = state.maxLittersIn18Months !== 999
    && (state.littersIn18mSource !== 'KENNEL_CLUB_STATE' || input.applyMemberBodyRules === true)
  if (applyFrequencyRule && (dam.last18mLitters ?? 0) >= state.maxLittersIn18Months) {
    findings.push({
      level: state.littersIn18mSource === 'STATE_LAW' && state.littersIn18mVerified ? 'block' : 'warn',
      source: state.littersIn18mSource,
      consequence: state.littersIn18mSource === 'STATE_LAW' ? 'LEGAL_OFFENCE' : 'ETHICS_BREACH',
      message: `${dam.last18mLitters} litters in the last 18 months (threshold ${state.maxLittersIn18Months})${state.littersIn18mVerified ? '' : ' — source pending verification'}`,
      rule: state.sourceName, verified: state.littersIn18mVerified,
    })
  }

  // ── C-sections ──
  const cs = dam.cSectionCount ?? 0
  if (state.maxCsections !== null && cs >= state.maxCsections) {
    findings.push({
      level: state.csectionVerified ? 'block' : 'warn', source: 'STATE_LAW',
      consequence: state.csectionVerified ? 'LEGAL_OFFENCE' : 'INFO',
      message: `C-section threshold reached (${state.maxCsections} in ${state.stateName})`,
      rule: state.csectionRule, verified: state.csectionVerified,
    })
  } else if (state.csectionVetRequired !== null && cs >= state.csectionVetRequired) {
    findings.push({
      level: 'warn', source: 'STATE_LAW', consequence: 'VET_CERT_REQUIRED',
      message: 'Veterinary review / written approval is required before further breeding under the selected jurisdiction rule',
      rule: state.csectionRule, verified: state.csectionVerified,
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
  if (jurisdiction === 'SA' && findings.every(f => f.level !== 'block')) {
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
    : '✓ Actual breeding compliance checks passed'

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
