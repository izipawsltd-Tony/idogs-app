import { describe, expect, it } from 'vitest'
import { canonicalPassportUrl } from './canonicalUrl'

describe('canonicalPassportUrl', () => {
  it('rewrites a staging passport URL to the public iDogs domain', () => {
    expect(canonicalPassportUrl('https://idogs-app-staging-example.vercel.app/p/QA--2023-4UPA'))
      .toBe('https://idogs.com.au/p/QA--2023-4UPA')
  })

  it('keeps the passport path but strips preview query parameters', () => {
    expect(canonicalPassportUrl('https://preview.vercel.app/p/PIN-2026-UY8R?_vercel_share=secret'))
      .toBe('https://idogs.com.au/p/PIN-2026-UY8R')
  })

  it('accepts an already canonical passport URL', () => {
    expect(canonicalPassportUrl('https://idogs.com.au/p/ABC-123'))
      .toBe('https://idogs.com.au/p/ABC-123')
  })

  it('fails closed to the iDogs homepage for a non-passport URL', () => {
    expect(canonicalPassportUrl('https://evil.example/phish'))
      .toBe('https://idogs.com.au')
  })
})
