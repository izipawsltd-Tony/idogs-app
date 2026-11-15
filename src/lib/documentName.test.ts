import { describe, expect, it } from 'vitest'
import { documentDisplayName, documentEditableName } from './documentName'

const label = (t: string) => ({ pedigree: 'Pedigree Certificate', vaccine_card: 'Vaccine Card' } as Record<string, string>)[t] || 'Document'

describe('documentDisplayName', () => {
  it('shows the uploaded custom name (stored as title), not the type label', () => {
    expect(documentDisplayName({ title: "Mum's pedigree", documentType: 'pedigree' }, label)).toBe("Mum's pedigree")
  })
  it('a rename (name) wins over the upload title', () => {
    expect(documentDisplayName({ name: 'Renamed', title: "Mum's pedigree", documentType: 'pedigree' }, label)).toBe('Renamed')
  })
  it('falls back to the type label only when no name exists (legacy records)', () => {
    expect(documentDisplayName({ documentType: 'pedigree' }, label)).toBe('Pedigree Certificate')
    expect(documentDisplayName({ name: '  ', title: '', documentType: 'vaccine_card' }, label)).toBe('Vaccine Card')
    expect(documentDisplayName({}, label)).toBe('Document')
  })
  it('keeps apostrophes, unicode and spacing inside the name exactly', () => {
    expect(documentDisplayName({ title: "  Mum's pedigree — Dogs SA 2026 ✓ " }, label)).toBe("Mum's pedigree — Dogs SA 2026 ✓")
  })
  it('edit field pre-fills with the name the user sees', () => {
    expect(documentEditableName({ title: "Mum's pedigree" })).toBe("Mum's pedigree")
    expect(documentEditableName({ name: 'Renamed', title: 'x' })).toBe('Renamed')
    expect(documentEditableName({})).toBe('')
  })
})
