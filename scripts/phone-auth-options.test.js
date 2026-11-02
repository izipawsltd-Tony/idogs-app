import { expect, it } from 'vitest'
import { australianSmsEnabled } from '../api/_lib/phone-auth-options.js'
const enabled = { phoneNumber: { enabled: true } }
it('distinguishes a fictional-US-only QA from an AU-enabled mobile signup', () => {
  expect(australianSmsEnabled({ signIn: enabled, smsRegionConfig: { allowlistOnly: { allowedRegions: ['US'] } } })).toBe(false)
  expect(australianSmsEnabled({ signIn: enabled, smsRegionConfig: { allowlistOnly: { allowedRegions: ['US', 'AU'] } } })).toBe(true)
  expect(australianSmsEnabled({ signIn: enabled, smsRegionConfig: { allowByDefault: { disallowedRegions: ['AU'] } } })).toBe(false)
  expect(australianSmsEnabled({ signIn: enabled, smsRegionConfig: { allowByDefault: { disallowedRegions: [] } } })).toBe(true)
  expect(australianSmsEnabled({ signIn: enabled })).toBe(false)
  expect(australianSmsEnabled({ smsRegionConfig: { allowlistOnly: { allowedRegions: ['AU'] } } })).toBe(false)
})
import { signupAvailability } from '../api/_lib/phone-auth-options.js'
it('summarises signup availability without exposing config details', () => {
  expect(signupAvailability({ signIn: { email: { enabled: true, passwordRequired: true }, phoneNumber: { enabled: true } } })).toEqual({ emailPassword: true, smsAustralia: 'allowed' })
  expect(signupAvailability({ signIn: { email: { enabled: false }, phoneNumber: { enabled: true } }, smsRegionConfig: { allowlistOnly: { allowedRegions: ['US'] } } })).toEqual({ emailPassword: false, smsAustralia: 'blocked' })
  expect(signupAvailability({ signIn: { phoneNumber: { enabled: true } }, smsRegionConfig: { allowByDefault: { disallowedRegions: ['AU'] } } })).toEqual({ emailPassword: false, smsAustralia: 'blocked' })
  expect(signupAvailability({ signIn: { phoneNumber: { enabled: false } } }).smsAustralia).toBe('disabled')
  expect(signupAvailability(undefined)).toEqual({ emailPassword: false, smsAustralia: 'disabled' })
})
