import { describe, it, expect } from 'vitest'
import {
  resolvePedigreeRegister,
  resolveBreedingEligibility,
  nextPedigreeRegisterUpdate,
  nextBreedingRightsUpdate,
  initialTransferPedigreeRegister,
  initialBreedingRightsValue,
  pedigreeRegisterLabel,
  breedingRightsLabel,
  checkBreedingCompliance,
  resolveComplianceJurisdiction,
  STATE_RULES,
} from './breedingCompliance'

// ─────────────────────────────────────────────────────────────────────────
// Regression coverage for the transferred-puppy pedigree/breeding-eligibility
// bug: a litter-born puppy has no `pedigreeRegister` set until someone edits
// it, and several call sites used to read that as `pedigreeRegister || 'main'`
// — silently turning "never recorded" into "Main Register — eligible to
// breed". These tests pin the corrected behaviour: missing data resolves to
// NOT_RECORDED, and MAIN never implies ELIGIBLE without an explicit flag.
//
// Follow-up round: neither ownership-transfer modal (LittersPage.tsx's
// inline modal, DogDetailPage.tsx's TransferModal) had any pedigree field
// at all, so a breeder had no way to record "Limited / family dog / not for
// breeding" AT the moment of transfer — the only place to do so was an
// unrelated Overview-tab control, discoverable only by accident. Both
// modals now show a "Pedigree / Registration" select, prefilled via
// initialTransferPedigreeRegister() and persisted via the SAME
// nextPedigreeRegisterUpdate() helper the Overview edit control uses (no
// second, parallel rule implementation) — merged into the SAME
// transferDogOwnership() Firestore write as the buyer/status fields.
//
// transferDogOwnership() (src/lib/db.ts) writes via a single Firestore
// partial update (updateDoc). BUYER_STATUS_PATCH below mirrors the
// buyer/status fields it always writes; simulateTransferWithSelection()
// additionally mirrors what both modals now do — merge in
// nextPedigreeRegisterUpdate()'s result — so the full modal flow can be
// exercised as a plain object merge, without needing a Firestore emulator.
// The claim-transferred-dogs API route (a separate write, unaffected by
// this round) still never touches these two fields.
// ─────────────────────────────────────────────────────────────────────────

const BUYER_STATUS_PATCH = {
  status: 'transferred',
  transferStatus: 'pendingClaim',
  previousOwnerId: 'breeder-uid',
  buyerName: 'Jane Buyer',
  buyerEmail: 'jane@example.com',
  transferredAt: '2026-09-01T00:00:00.000Z',
} as const

// Simulates the OLD/no-pedigree-control shape: transfer touches only
// buyer/status fields, leaving pedigreeRegister/breedingEligibility exactly
// as they were. No longer what the real UI does (both modals always pass a
// pedigree selection now), but still a valid shape transferDogOwnership()
// itself supports, since its pedigree params remain optional.
function simulateTransfer<T extends Record<string, unknown>>(original: T) {
  return { ...original, ...BUYER_STATUS_PATCH }
}

// Simulates the actual current modal flow: the breeder's pedigree
// selection (defaulting to whatever initialTransferPedigreeRegister()
// prefilled, if they never touch the control) is resolved via
// nextPedigreeRegisterUpdate() and merged into the SAME write as the
// buyer/status fields.
function simulateTransferWithSelection<T extends { pedigreeRegister?: string; breedingEligibility?: string }>(
  original: T,
  selectedRegisterRaw: string,
) {
  const pedigreeUpdate = nextPedigreeRegisterUpdate(original.pedigreeRegister, selectedRegisterRaw)
  return { ...original, ...BUYER_STATUS_PATCH, ...pedigreeUpdate }
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
    expect(result.headline).toContain('breeding rights do not permit')
  })

  it('CASE B: MAIN + no explicit eligibility renders as unconfirmed, not a green "eligible" pass', () => {
    const result = checkBreedingCompliance({ dam: { ...baseDam, pedigreeRegister: 'main' }, state: 'SA' })
    expect(result.overall).not.toBe('ok')
    expect(result.headline).toContain('breeding rights not confirmed')
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
    expect(result.headline).toBe('✓ Actual breeding compliance checks passed')
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
  it('the buyer/status patch itself never includes pedigreeRegister or breedingEligibility keys', () => {
    expect(BUYER_STATUS_PATCH).not.toHaveProperty('pedigreeRegister')
    expect(BUYER_STATUS_PATCH).not.toHaveProperty('breedingEligibility')
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

// ─────────────────────────────────────────────────────────────────────────
// Transfer-modal pedigree selection (this round's fix): both ownership-
// transfer modals now surface a Main/Limited/Not-recorded control at the
// moment of transfer, persisted via the same nextPedigreeRegisterUpdate()
// helper — required scenarios 1-6 below.
// ─────────────────────────────────────────────────────────────────────────

// Item 12 (this round): the transfer confirm checkbox previously only named
// the buyer ("I confirm I want to transfer Rex to this buyer") — it never
// named the pedigree value the breeder was locking in for the buyer at the
// same moment. pedigreeRegisterLabel() is the shared text used to fix that
// in both modals' confirm checkbox, so the label can't drift from
// resolvePedigreeRegister's own states.
describe('pedigreeRegisterLabel — transfer confirmation copy', () => {
  it('produces a distinct, human-readable label for every one of the six values', () => {
    expect(pedigreeRegisterLabel('main')).toBe('Main Register')
    expect(pedigreeRegisterLabel('limited')).toBe('Limited Register')
    expect(pedigreeRegisterLabel('not_recorded')).toBe('Not recorded')
    expect(pedigreeRegisterLabel('no_pedigree')).toBe('No pedigree')
    expect(pedigreeRegisterLabel('mixed')).toBe('Mixed breed')
    expect(pedigreeRegisterLabel('rescue')).toBe('Rescue / unknown')
  })

  it('missing/undefined labels as Not recorded, never Main Register', () => {
    expect(pedigreeRegisterLabel(undefined)).toBe('Not recorded')
    expect(pedigreeRegisterLabel(undefined)).not.toBe('Main Register')
  })
})

describe('initialTransferPedigreeRegister — prefilling the transfer modal control', () => {
  // Required scenario 1
  it('missing puppy pedigree enters the transfer modal as not_recorded, never main', () => {
    expect(initialTransferPedigreeRegister(undefined)).toBe('not_recorded')
    expect(initialTransferPedigreeRegister('')).not.toBe('main')
    expect(initialTransferPedigreeRegister(undefined)).not.toBe('main')
  })

  it('an existing Limited puppy prefills as limited (required scenario 5, part 1)', () => {
    expect(initialTransferPedigreeRegister('limited')).toBe('limited')
  })

  it('an existing Main puppy prefills as main', () => {
    expect(initialTransferPedigreeRegister('main')).toBe('main')
  })

  // Regression: an earlier version of this helper only recognised
  // 'main'/'limited' and silently coerced everything else — including a
  // deliberately-set 'no_pedigree'/'mixed'/'rescue' classification — to
  // 'not_recorded'. That is exactly the unacceptable data mutation this
  // round fixes: transfer must never reclassify an existing valid value
  // just because the breeder didn't touch the control. Required scenarios
  // 1-4 (adapted from "enters transfer as X" to "prefills as X", since the
  // prefill IS the value the transfer modal shows/persists if untouched).
  it('no_pedigree enters the transfer modal unchanged, and remains no_pedigree if untouched', () => {
    expect(initialTransferPedigreeRegister('no_pedigree')).toBe('no_pedigree')
  })

  it('mixed enters the transfer modal unchanged, and remains mixed if untouched', () => {
    expect(initialTransferPedigreeRegister('mixed')).toBe('mixed')
  })

  it('rescue enters the transfer modal unchanged, and remains rescue if untouched', () => {
    expect(initialTransferPedigreeRegister('rescue')).toBe('rescue')
  })

  it('an existing not_recorded value round-trips as itself (not re-derived)', () => {
    expect(initialTransferPedigreeRegister('not_recorded')).toBe('not_recorded')
  })

  it('undefined becomes not_recorded — the only case that falls back', () => {
    expect(initialTransferPedigreeRegister(undefined)).toBe('not_recorded')
    expect(initialTransferPedigreeRegister('')).toBe('not_recorded')
    expect(initialTransferPedigreeRegister('some_unrecognised_legacy_value')).toBe('not_recorded')
  })
})

describe('scenario: transferring an existing adult dog without touching pedigree (no_pedigree/mixed/rescue)', () => {
  // Required scenarios 1-3, exercised end-to-end through the same
  // prefill -> (untouched) -> persist path both transfer modals use.
  it.each(['no_pedigree', 'mixed', 'rescue'] as const)(
    '%s survives prefill + an untouched transfer submission unchanged',
    (existingValue) => {
      const dog: { name: string; breed: string; pedigreeRegister?: string; breedingEligibility?: string } = {
        name: 'Bailey', breed: 'Mixed', pedigreeRegister: existingValue,
      }
      const prefilled = initialTransferPedigreeRegister(dog.pedigreeRegister)
      expect(prefilled).toBe(existingValue)
      const buyerCopy = simulateTransferWithSelection(dog, prefilled)
      expect(buyerCopy.pedigreeRegister).toBe(existingValue)
      expect(resolvePedigreeRegister(buyerCopy.pedigreeRegister)).toBe(
        existingValue === 'no_pedigree' ? 'NO_PEDIGREE' : existingValue === 'mixed' ? 'MIXED' : 'RESCUE',
      )
      // No ELIGIBLE is ever invented for these states — resolver-consistent UNKNOWN.
      expect(resolveBreedingEligibility(buyerCopy)).toBe('UNKNOWN')
    },
  )
})

describe('scenario: transfer modal — breeder selects a pedigree register at transfer time', () => {
  const puppy: { name: string; breed: string; microchip: string; pedigreeRegister?: string; breedingEligibility?: string } = {
    name: 'Rex', breed: 'Labrador', microchip: '900000000123456',
  }

  // Required scenario 2
  it('selecting LIMITED persists pedigreeRegister=limited and breedingEligibility=not_eligible', () => {
    const result = simulateTransferWithSelection(puppy, 'limited')
    expect(result.pedigreeRegister).toBe('limited')
    expect(result.breedingEligibility).toBe('not_eligible')
    expect(resolvePedigreeRegister(result.pedigreeRegister)).toBe('LIMITED')
    expect(resolveBreedingEligibility(result)).toBe('NOT_ELIGIBLE')
  })

  // Required scenario 3
  it('selecting MAIN persists pedigreeRegister=main without automatically becoming eligible', () => {
    const result = simulateTransferWithSelection(puppy, 'main')
    expect(result.pedigreeRegister).toBe('main')
    expect(result.breedingEligibility).toBeUndefined()
    expect(resolveBreedingEligibility(result)).toBe('UNKNOWN')
  })

  it('selecting MAIN preserves an existing explicit eligible flag (does not reset it)', () => {
    const alreadyEligible = { ...puppy, pedigreeRegister: 'main', breedingEligibility: 'eligible' as const }
    const result = simulateTransferWithSelection(alreadyEligible, 'main')
    expect(result.pedigreeRegister).toBe('main')
    expect(result.breedingEligibility).toBe('eligible')
    expect(resolveBreedingEligibility(result)).toBe('ELIGIBLE')
  })

  // Required scenario 4
  it('selecting NOT_RECORDED persists pedigreeRegister=not_recorded with unknown eligibility', () => {
    const result = simulateTransferWithSelection(puppy, 'not_recorded')
    expect(result.pedigreeRegister).toBe('not_recorded')
    expect(result.breedingEligibility).toBe('unknown')
    expect(resolvePedigreeRegister(result.pedigreeRegister)).toBe('NOT_RECORDED')
    expect(resolveBreedingEligibility(result)).toBe('UNKNOWN')
  })

  // Required scenario 5 (part 2) + 6: an existing Limited puppy, prefilled
  // Limited in the modal, transferred without the breeder changing anything
  // — the buyer receives exactly that selection.
  it('an existing Limited puppy stays Limited/not_eligible end-to-end through prefill + transfer', () => {
    const existingLimitedPuppy = { ...puppy, pedigreeRegister: 'limited' as const }
    const prefilled = initialTransferPedigreeRegister(existingLimitedPuppy.pedigreeRegister)
    expect(prefilled).toBe('limited')
    const buyerCopy = simulateTransferWithSelection(existingLimitedPuppy, prefilled)
    expect(buyerCopy.pedigreeRegister).toBe('limited')
    expect(buyerCopy.breedingEligibility).toBe('not_eligible')
    expect(resolveBreedingEligibility(buyerCopy)).toBe('NOT_ELIGIBLE')
  })

  // Required scenario 7: existing transfer buyer/status fields still work
  // once a pedigree selection is merged into the same write.
  it('buyer/status fields are still written correctly alongside the pedigree selection', () => {
    const result = simulateTransferWithSelection(puppy, 'limited')
    expect(result.status).toBe('transferred')
    expect(result.transferStatus).toBe('pendingClaim')
    expect(result.buyerName).toBe('Jane Buyer')
    expect(result.buyerEmail).toBe('jane@example.com')
    expect(result.previousOwnerId).toBe('breeder-uid')
    // And unrelated dog data is still untouched
    expect(result.name).toBe('Rex')
    expect(result.microchip).toBe('900000000123456')
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

describe('three-layer model — Pedigree registration → Breeding rights → Actual compliance', () => {
  it('maps stored eligibility into the breeder-facing Breeding rights layer', () => {
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main' })).toBe('unknown')
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main', breedingEligibility: 'eligible' })).toBe('eligible')
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main', breedingEligibility: 'not_eligible' })).toBe('not_eligible')
  })

  it('labels rights without claiming actual compliance', () => {
    expect(breedingRightsLabel('eligible')).toBe('Breeding permitted')
    expect(breedingRightsLabel('not_eligible')).toBe('Not permitted')
    expect(breedingRightsLabel('unknown')).toBe('Not confirmed')
  })

  it('allows an explicit breeder decision only on Main Register', () => {
    expect(nextBreedingRightsUpdate('main', 'eligible')).toEqual({ breedingEligibility: 'eligible' })
    expect(nextBreedingRightsUpdate('main', 'not_eligible')).toEqual({ breedingEligibility: 'not_eligible' })
    expect(nextBreedingRightsUpdate('main', 'unknown')).toEqual({ breedingEligibility: 'unknown' })
  })

  it('Limited Register always forces Not permitted', () => {
    expect(nextBreedingRightsUpdate('limited', 'eligible')).toEqual({ breedingEligibility: 'not_eligible' })
  })

  it('non-authoritative registration states can never be promoted to permitted by the rights control', () => {
    expect(nextBreedingRightsUpdate(undefined, 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('not_recorded', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('no_pedigree', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('mixed', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('rescue', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
  })

  it('breeding rights confirmed still requires the separate compliance engine to pass', () => {
    const result = checkBreedingCompliance({
      dam: { name: 'Young Main Dog', breed: 'Labrador', dateOfBirth: new Date().toISOString().slice(0, 10), pedigreeRegister: 'main', breedingEligibility: 'eligible' },
      state: 'SA',
    })
    expect(result.overall).toBe('block')
    expect(result.headline).not.toContain('Actual breeding compliance checks passed')
  })

  it('an adult Main dog with confirmed rights can reach the distinct actual-compliance pass headline', () => {
    const result = checkBreedingCompliance({
      dam: { name: 'Adult Main Dog', breed: 'Poodle', dateOfBirth: '2020-01-01', pedigreeRegister: 'main', breedingEligibility: 'eligible' },
      state: 'SA',
    })
    expect(result.overall).not.toBe('block')
    expect(result.overall).not.toBe('warn')
    expect(result.headline).toBe('✓ Actual breeding compliance checks passed')
  })
})


describe('jurisdiction-aware compliance', () => {
  const mainDam = {
    name: 'Jurisdiction Dam',
    breed: 'Poodle',
    dateOfBirth: '2020-01-01',
    pedigreeRegister: 'main',
    breedingEligibility: 'eligible',
  }

  it('recognises all eight Australian jurisdictions and fails closed for missing/invalid values', () => {
    for (const code of ['SA', 'NSW', 'VIC', 'QLD', 'WA', 'TAS', 'ACT', 'NT']) {
      expect(resolveComplianceJurisdiction(code)).toBe(code)
      expect(resolveComplianceJurisdiction(code.toLowerCase())).toBe(code)
    }
    expect(resolveComplianceJurisdiction(undefined)).toBeNull()
    expect(resolveComplianceJurisdiction('')).toBeNull()
    expect(resolveComplianceJurisdiction('XX')).toBeNull()
  })

  it('never falls back missing jurisdiction to South Australia', () => {
    const result = checkBreedingCompliance({ dam: mainDam })
    expect(result.overall).toBe('warn')
    expect(result.headline).toContain('jurisdiction not set')
    expect(result.findings.some(f => f.rule.includes('SA S&G'))).toBe(false)
  })

  it('encodes ACT verified limits as ACT rules, not generic SA defaults', () => {
    expect(STATE_RULES.ACT.minBreedingMonths).toBe(18)
    expect(STATE_RULES.ACT.maxLifetimeLitters).toBe(4)
    expect(STATE_RULES.ACT.maxLittersIn18Months).toBe(1)
    expect(STATE_RULES.ACT.maxAgeYears).toBe(6)
    const result = checkBreedingCompliance({ dam: { ...mainDam, litterCount: 4 }, state: 'ACT' })
    expect(result.findings.some(f => f.level === 'warn' && f.source === 'STATE_LAW' && f.message.includes('4 litters'))).toBe(true)
  })

  it('encodes Tasmania 5-litter and age-7 vet-determination thresholds', () => {
    expect(STATE_RULES.TAS.maxLifetimeLitters).toBe(5)
    expect(STATE_RULES.TAS.lifetimeLittersVetExemption).toBe(true)
    expect(STATE_RULES.TAS.vetCertAfterAgeYears).toBe(7)
    const result = checkBreedingCompliance({ dam: { ...mainDam, litterCount: 5 }, state: 'TAS' })
    expect(result.findings.some(f => f.consequence === 'VET_CERT_REQUIRED' && f.verified)).toBe(true)
  })

  it('encodes NSW BIN, lifetime litter and C-section rules as verified', () => {
    expect(STATE_RULES.NSW.requiresBIN).toBe(true)
    expect(STATE_RULES.NSW.maxLifetimeLitters).toBe(5)
    expect(STATE_RULES.NSW.maxCsections).toBe(3)
    expect(STATE_RULES.NSW.csectionVerified).toBe(true)
    const result = checkBreedingCompliance({ dam: { ...mainDam, cSectionCount: 3 }, state: 'NSW' })
    expect(result.findings.some(f => f.level === 'block' && f.message.includes('C-section'))).toBe(true)
  })

  it('does not invent a universal 5-litter state cap for VIC, QLD, WA or NT', () => {
    for (const code of ['VIC', 'QLD', 'WA', 'NT'] as const) {
      expect(STATE_RULES[code].maxLifetimeLitters).toBe(999)
      const result = checkBreedingCompliance({ dam: { ...mainDam, litterCount: 6 }, state: code })
      expect(result.findings.some(f => f.message.includes('Lifetime litter'))).toBe(false)
    }
  })

  it('keeps conditional member-body frequency rules off unless membership is explicitly applied', () => {
    const dam = { ...mainDam, last18mLitters: 2 }
    const withoutMembership = checkBreedingCompliance({ dam, state: 'SA' })
    expect(withoutMembership.findings.some(f => f.source === 'KENNEL_CLUB_STATE' && f.message.includes('18 months'))).toBe(false)
    const withMembership = checkBreedingCompliance({ dam, state: 'SA', applyMemberBodyRules: true })
    expect(withMembership.findings.some(f => f.source === 'KENNEL_CLUB_STATE' && f.message.includes('18 months'))).toBe(true)
  })
})
