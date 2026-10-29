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
