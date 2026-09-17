import { describe, it, expect } from 'vitest'
import {
  resolvePedigreeRegister,
  resolveBreedingEligibility,
  nextPedigreeRegisterUpdate,
  checkBreedingCompliance,
} from './breedingCompliance'

// ─────────────────────────────────────────────────────────────────────────
// Regression coverage for the transferred-puppy pedigree/breeding-eligibility
// bug: a litter-born puppy has no `pedigreeRegister` set until someone edits
// it, and several call sites used to read that as `pedigreeRegister || 'main'`
// — silently turning "never recorded" into "Main Register — eligible to
// breed". These tests pin the corrected behaviour: missing data resolves to
// NOT_RECORDED, and MAIN never implies ELIGIBLE without an explicit flag.
//
// transferDogOwnership() (src/lib/db.ts) and the claim-transferred-dogs API
// route both write via Firestore partial updates (updateDoc/tx.update) that
// never touch `pedigreeRegister`/`breedingEligibility` — so a real transfer
// preserves whatever was already on the dog document. TRANSFER_PATCH below
// mirrors that exact field set (kept in sync with db.ts's
// transferDogOwnership) so "transfer" scenarios can be exercised as a plain
// object merge, without needing a Firestore emulator.
// ─────────────────────────────────────────────────────────────────────────

const TRANSFER_PATCH = {
  status: 'transferred',
  transferStatus: 'pendingClaim',
  previousOwnerId: 'breeder-uid',
  buyerName: 'Jane Buyer',
  buyerEmail: 'jane@example.com',
  transferredAt: '2026-09-01T00:00:00.000Z',
} as const

function simulateTransfer<T extends Record<string, unknown>>(original: T) {
  return { ...original, ...TRANSFER_PATCH }
}

describe('resolvePedigreeRegister', () => {
  it('resolves known values', () => {
    expect(resolvePedigreeRegister('main')).toBe('MAIN')
    expect(resolvePedigreeRegister('limited')).toBe('LIMITED')
    expect(resolvePedigreeRegister('no_pedigree')).toBe('NO_PEDIGREE')
    expect(resolvePedigreeRegister('mixed')).toBe('MIXED')
    expect(resolvePedigreeRegister('rescue')).toBe('RESCUE')
  })

  it('never defaults missing/undefined/unrecognised values to MAIN', () => {
    expect(resolvePedigreeRegister(undefined)).toBe('NOT_RECORDED')
    expect(resolvePedigreeRegister('')).toBe('NOT_RECORDED')
    expect(resolvePedigreeRegister('not_recorded')).toBe('NOT_RECORDED')
    expect(resolvePedigreeRegister('some_legacy_value')).toBe('NOT_RECORDED')
  })
})

describe('resolveBreedingEligibility', () => {
  it('LIMITED is always NOT_ELIGIBLE, even if breedingEligibility says otherwise', () => {
    expect(resolveBreedingEligibility({ pedigreeRegister: 'limited' })).toBe('NOT_ELIGIBLE')
    expect(resolveBreedingEligibility({ pedigreeRegister: 'limited', breedingEligibility: 'eligible' })).toBe('NOT_ELIGIBLE')
  })

  it('MAIN does not imply ELIGIBLE — UNKNOWN unless explicitly confirmed', () => {
    expect(resolveBreedingEligibility({ pedigreeRegister: 'main' })).toBe('UNKNOWN')
    expect(resolveBreedingEligibility({ pedigreeRegister: 'main', breedingEligibility: 'eligible' })).toBe('ELIGIBLE')
    expect(resolveBreedingEligibility({ pedigreeRegister: 'main', breedingEligibility: 'not_eligible' })).toBe('NOT_ELIGIBLE')
  })

  it('NOT_RECORDED (missing pedigreeRegister) is always UNKNOWN, never ELIGIBLE', () => {
    expect(resolveBreedingEligibility({})).toBe('UNKNOWN')
    expect(resolveBreedingEligibility({ breedingEligibility: 'eligible' })).toBe('UNKNOWN')
  })

  it('NO_PEDIGREE / MIXED / RESCUE are always UNKNOWN', () => {
    expect(resolveBreedingEligibility({ pedigreeRegister: 'no_pedigree' })).toBe('UNKNOWN')
    expect(resolveBreedingEligibility({ pedigreeRegister: 'mixed' })).toBe('UNKNOWN')
    expect(resolveBreedingEligibility({ pedigreeRegister: 'rescue' })).toBe('UNKNOWN')
  })
})

// Scenario 1: Limited puppy transfer → transferred dog remains LIMITED / NOT_ELIGIBLE
describe('scenario: limited puppy transfer', () => {
  it('stays LIMITED / NOT_ELIGIBLE after a simulated ownership transfer', () => {
    const puppy = { name: 'Rex', breed: 'Labrador', pedigreeRegister: 'limited' as const }
    const afterTransfer = simulateTransfer(puppy)
    expect(resolvePedigreeRegister(afterTransfer.pedigreeRegister)).toBe('LIMITED')
    expect(resolveBreedingEligibility(afterTransfer)).toBe('NOT_ELIGIBLE')
  })
})

// Scenario 2: Main puppy transfer → transferred dog remains MAIN
describe('scenario: main puppy transfer', () => {
  it('stays MAIN, and any explicit eligibility flag survives the transfer', () => {
    const puppy = { name: 'Bella', breed: 'Golden Retriever', pedigreeRegister: 'main' as const, breedingEligibility: 'eligible' as const }
    const afterTransfer = simulateTransfer(puppy)
    expect(resolvePedigreeRegister(afterTransfer.pedigreeRegister)).toBe('MAIN')
    expect(resolveBreedingEligibility(afterTransfer)).toBe('ELIGIBLE')
  })
})

// Scenario 3: Missing pedigree data → NOT_RECORDED / UNKNOWN, never MAIN
describe('scenario: missing pedigree data (the reported bug)', () => {
  it('a litter-born puppy with no pedigreeRegister set resolves to NOT_RECORDED / UNKNOWN, both before and after transfer', () => {
    // No pedigreeRegister — matches createLitterPuppyAtomic's payload, which
    // never sets this field at puppy-creation time.
    const puppy: { name: string; breed: string; pedigreeRegister?: string; breedingEligibility?: string } = {
      name: 'Unnamed Pup', breed: 'Poodle',
    }
    expect(resolvePedigreeRegister(puppy.pedigreeRegister)).toBe('NOT_RECORDED')
    expect(resolveBreedingEligibility(puppy)).toBe('UNKNOWN')

    const afterTransfer = simulateTransfer(puppy)
    expect(resolvePedigreeRegister(afterTransfer.pedigreeRegister)).toBe('NOT_RECORDED')
    expect(resolveBreedingEligibility(afterTransfer)).toBe('UNKNOWN')
  })
})

// Scenario 4: MAIN → LIMITED edit forces NOT_ELIGIBLE (rule 6)
describe('scenario: editing MAIN/NOT_RECORDED → LIMITED', () => {
  it('MAIN → LIMITED forces breedingEligibility to not_eligible', () => {
    const update = nextPedigreeRegisterUpdate('main', 'limited')
    expect(update).toEqual({ pedigreeRegister: 'limited', breedingEligibility: 'not_eligible' })
  })

  it('NOT_RECORDED → LIMITED also forces breedingEligibility to not_eligible', () => {
    const update = nextPedigreeRegisterUpdate(undefined, 'limited')
    expect(update).toEqual({ pedigreeRegister: 'limited', breedingEligibility: 'not_eligible' })
  })
})

// Scenario 5: LIMITED → MAIN edit must NOT auto-become ELIGIBLE (rule 7)
describe('scenario: editing LIMITED → MAIN', () => {
  it('resets breedingEligibility to unknown, never eligible', () => {
    const update = nextPedigreeRegisterUpdate('limited', 'main')
    expect(update).toEqual({ pedigreeRegister: 'main', breedingEligibility: 'unknown' })
    expect(resolveBreedingEligibility(update)).toBe('UNKNOWN')
  })

  it('a genuinely unrelated register change (MAIN → MAIN) leaves breedingEligibility untouched', () => {
    const update = nextPedigreeRegisterUpdate('main', 'main')
    expect(update).toEqual({ pedigreeRegister: 'main' })
  })
})

// Scenario 6 + CASE A/B/C/D: Breeding Compliance headline/overall per register state
describe('checkBreedingCompliance — register/eligibility headline', () => {
  const baseDam = { name: 'Dam', breed: 'Poodle', dateOfBirth: '2020-01-01' }

  it('CASE A: LIMITED renders as blocked, not eligible', () => {
    const result = checkBreedingCompliance({ dam: { ...baseDam, pedigreeRegister: 'limited' }, state: 'SA' })
    expect(result.overall).toBe('block')
    expect(result.headline).toContain('Limited Register')
    expect(result.headline).toContain('not eligible')
  })

  it('CASE B: MAIN + no explicit eligibility renders as unconfirmed, not a green "eligible" pass', () => {
    const result = checkBreedingCompliance({ dam: { ...baseDam, pedigreeRegister: 'main' }, state: 'SA' })
    expect(result.overall).not.toBe('ok')
    expect(result.headline).toContain('breeding eligibility not confirmed')
  })

  it('CASE C: MAIN + explicit eligible renders as eligible (subject to other findings)', () => {
    const result = checkBreedingCompliance({
      dam: { ...baseDam, pedigreeRegister: 'main', breedingEligibility: 'eligible' },
      state: 'SA',
    })
    // SA always appends an informational legal reminder when nothing blocks,
    // so `overall` can be 'info' here — the headline is what the badge shows.
    expect(result.overall).not.toBe('block')
    expect(result.overall).not.toBe('warn')
    expect(result.headline).toBe('✓ Currently eligible to breed')
  })

  // Scenario 7: Not Recorded renders correctly
  it('CASE D: missing pedigreeRegister renders as "not recorded", never as Main/eligible', () => {
    const result = checkBreedingCompliance({ dam: { ...baseDam }, state: 'SA' })
    expect(result.overall).not.toBe('ok')
    expect(result.headline).toContain('Registration not recorded')
    expect(result.headline).not.toContain('Main Register')
  })

  it('never produces a green "Compliant"/eligible outcome for a Limited dam', () => {
    const result = checkBreedingCompliance({ dam: { ...baseDam, pedigreeRegister: 'limited' }, state: 'SA' })
    expect(result.overall).not.toBe('ok')
  })
})

// Scenario 8 + 9: transfer preserves unrelated data and doesn't touch pedigree fields
describe('scenario: ownership transfer preserves unrelated dog data', () => {
  it('the transfer patch itself never includes pedigreeRegister or breedingEligibility keys', () => {
    expect(TRANSFER_PATCH).not.toHaveProperty('pedigreeRegister')
    expect(TRANSFER_PATCH).not.toHaveProperty('breedingEligibility')
  })

  it('unrelated fields (name, breed, microchip, ankc) survive a simulated transfer unchanged', () => {
    const original = {
      name: 'Rex',
      breed: 'Labrador',
      microchip: '900000000123456',
      ankc: '4100353152',
      pedigreeRegister: 'limited' as const,
    }
    const afterTransfer = simulateTransfer(original)
    expect(afterTransfer.name).toBe('Rex')
    expect(afterTransfer.breed).toBe('Labrador')
    expect(afterTransfer.microchip).toBe('900000000123456')
    expect(afterTransfer.ankc).toBe('4100353152')
    expect(afterTransfer.pedigreeRegister).toBe('limited')
    // Existing transfer behaviour (status/buyer fields) still applies
    expect(afterTransfer.status).toBe('transferred')
    expect(afterTransfer.buyerName).toBe('Jane Buyer')
  })
})

describe('checkBreedingCompliance — sire register/eligibility (mirrors dam handling)', () => {
  const baseDam = { name: 'Dam', breed: 'Poodle', dateOfBirth: '2020-01-01', pedigreeRegister: 'main', breedingEligibility: 'eligible' as const }

  it('a Limited sire blocks compliance even when the dam is fully eligible', () => {
    const result = checkBreedingCompliance({
      dam: baseDam,
      sire: { name: 'Sire', dateOfBirth: '2019-01-01', pedigreeRegister: 'limited' },
      state: 'SA',
    })
    expect(result.overall).toBe('block')
    expect(result.headline).toContain('Sire')
  })

  it('a sire with no pedigreeRegister recorded surfaces as a warning, not silent Main/eligible', () => {
    const result = checkBreedingCompliance({
      dam: baseDam,
      sire: { name: 'Sire', dateOfBirth: '2019-01-01' },
      state: 'SA',
    })
    expect(result.overall).not.toBe('ok')
    expect(result.findings.some(f => f.message.includes('registration not recorded'))).toBe(true)
  })
})
