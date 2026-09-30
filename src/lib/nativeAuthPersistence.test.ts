import { describe, expect, it } from 'vitest'
import { shouldUseBrowserLocalAuthPersistence } from './nativeAuthPersistence'

describe('Android auth persistence selection', () => {
  it('uses durable browser-local persistence for Android native builds', () => {
    expect(shouldUseBrowserLocalAuthPersistence('android')).toBe(true)
    expect(shouldUseBrowserLocalAuthPersistence(' ANDROID ')).toBe(true)
  })

  it('does not override regular web or non-Android native builds', () => {
    expect(shouldUseBrowserLocalAuthPersistence(undefined)).toBe(false)
    expect(shouldUseBrowserLocalAuthPersistence('')).toBe(false)
    expect(shouldUseBrowserLocalAuthPersistence('ios')).toBe(false)
  })
})
