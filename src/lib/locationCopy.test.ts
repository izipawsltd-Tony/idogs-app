import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Owner directive (21 Nov 2026): public location copy says "Australia" (the operating
// location may move to Sydney). Governing law, timezone semantics and complaints/contact
// details must NOT be changed by that copy update. Legal wording is pending legal review.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const landing = read('../pages/LandingPage.tsx')
const privacy = read('../pages/PrivacyPage.tsx')
const terms = read('../pages/TermsPage.tsx')

describe('public location copy says Australia', () => {
  it('landing footer operator line', () => {
    expect(landing).toContain('iDogs is operated by iziPaws Pty Ltd (ABN 42 693 563 745), Australia.')
  })
  it('privacy section 1 and section 11', () => {
    expect(privacy).toContain('We operate in Australia.')
    expect(privacy).toMatch(/11\. Contact and Complaints[\s\S]*?ABN: 42 693 563 745<br \/>Australia<br \/>Email: hello@idogs\.com\.au/)
  })
  it('terms section 12 contact', () => {
    expect(terms).toMatch(/12\. Contact[\s\S]*?ABN: 42 693 563 745<br \/>Australia<br \/>Email: hello@idogs\.com\.au/)
  })
  it('no public page still says Adelaide, South Australia as a location', () => {
    for (const src of [landing, privacy, terms]) {
      expect(src).not.toMatch(/Adelaide,\s*South Australia/i)
      expect(src).not.toMatch(/based in Adelaide/i)
      expect(src).not.toMatch(/Built in Adelaide/i)
    }
  })
})

describe('copy update left legal and timezone semantics alone', () => {
  it('terms governing law still names South Australia (needs legal review to change)', () => {
    expect(terms).toContain('These Terms are governed by the laws of South Australia, Australia.')
    expect(terms).toContain('exclusive jurisdiction of the courts of South Australia')
  })
  it('gift voucher deadline keeps its Adelaide time semantics', () => {
    expect(landing).toContain('(Adelaide time)')
  })
  it('privacy still gives a usable contact and a complaint route', () => {
    expect(privacy).toContain('hello@idogs.com.au')
    expect(privacy).toContain('Office of the Australian Information Commissioner (OAIC)')
    expect(privacy).toContain('1300 363 992')
  })
})
