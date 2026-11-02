import { expect, it } from 'vitest'
import { phoneSignInErrorCode, phoneSignInErrorMessage } from './phoneSignInError'

const fb = (code: string, extra = '') => Object.assign(new Error(`Firebase: ${extra}Error (${code}).`), { code })
it('a web address missing from Firebase authorized domains is NOT reported as a cookie problem', () => {
  for (const e of [fb('auth/unauthorized-domain'), fb('auth/captcha-check-failed', 'Hostname match not found '), new Error('Firebase: Hostname match not found (auth/captcha-check-failed).')]) {
    expect(phoneSignInErrorMessage(e)).toContain('isn’t available on this web address')
    expect(phoneSignInErrorMessage(e)).not.toContain('cookies')
  }
})
it('keeps the existing customer messages for other codes', () => {
  expect(phoneSignInErrorMessage(fb('auth/invalid-app-credential'))).toContain('browser security check')
  expect(phoneSignInErrorMessage(fb('auth/invalid-verification-code'))).toBe('That code is not correct. Please try again.')
  expect(phoneSignInErrorMessage(fb('auth/too-many-requests'))).toContain('Too many requests')
  expect(phoneSignInErrorMessage(new Error('Please agree to the Terms & Conditions before continuing.'))).toContain('Terms')
})
it('extracts only the auth/... code for diagnostics (never the message details)', () => {
  expect(phoneSignInErrorCode(fb('auth/captcha-check-failed', 'Hostname match not found '))).toBe('auth/captcha-check-failed')
  expect(phoneSignInErrorCode(new Error('Firebase: Error (auth/quota-exceeded).'))).toBe('auth/quota-exceeded')
  expect(phoneSignInErrorCode(new Error('+61400000000 123456'))).toBe('unknown')
})
