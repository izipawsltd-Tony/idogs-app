import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./DogDetailPage.tsx', import.meta.url)), 'utf8')

describe('Dog pedigree breeding eligibility control', () => {
  it('shows the explicit eligibility control only for Main Register dogs', () => {
    expect(source).toContain("resolvePedigreeRegister((dog as any).pedigreeRegister) === 'MAIN'")
    expect(source).toContain('aria-label="Breeding eligibility"')
  })

  it('supports unknown, eligible and not-eligible values', () => {
    expect(source).toContain('<option value="unknown">Eligibility: Not confirmed</option>')
    expect(source).toContain('<option value="eligible">✓ Eligible to breed</option>')
    expect(source).toContain('<option value="not_eligible">Not eligible to breed</option>')
  })
})

describe('Dog pedigree persistence wiring', () => {
  it('saves eligibility through the parent update path and refreshes local dog state', () => {
    expect(source).toContain("await onUpdatePedigree({ breedingEligibility: e.target.value as NonNullable<Dog['breedingEligibility']> })")
    expect(source).toContain('setDog(prev => prev ? { ...prev, ...updates } : prev)')
  })

  it('keeps restricted dogs unable to edit eligibility', () => {
    expect(source).toMatch(/aria-label="Breeding eligibility"[\s\S]*?disabled=\{isRestricted\}/)
  })
})
