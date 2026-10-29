import { describe, expect, it } from 'vitest'
import { emailReturnUrl, normalizeSigninPhone, readPendingSignin } from './passwordless'
describe('passwordless contact and return state', () => {
  it('preserves QR follow intent but never puts contact details into the link', () => {
    const url = new URL(emailReturnUrl('https://qa.example.invalid', '/app/puppy-updates/RUBY?follow=1', 'flow-1234567890123456'))
    expect(url.pathname).toBe('/auth/finish'); expect(url.searchParams.get('next')).toBe('/app/puppy-updates/RUBY?follow=1')
    expect([...url.searchParams.keys()]).toEqual(['next', 'flow'])
  })
  it('rejects external post-login destinations', () => {
    expect(new URL(emailReturnUrl('https://qa.example.invalid', 'https://evil.invalid', '1234567890123456')).searchParams.get('next')).toBe('/app/start')
  })
  it('requires email re-entry for missing, corrupt, or stale local state', () => {
    for (const value of [null, '{', JSON.stringify({ email: 'qa@example.invalid', name: 'QA', createdAt: Date.now() - 3600001 })]) {
      expect(readPendingSignin('1234567890123456', { getItem: () => value })).toBeNull()
    }
  })
  it('normalizes Australian mobiles without changing international numbers', () => {
    expect(normalizeSigninPhone('0412 345 678')).toBe('+61412345678')
    expect(normalizeSigninPhone('+1 (650) 555-3434')).toBe('+16505553434')
    expect(() => normalizeSigninPhone('123')).toThrow()
  })
})
