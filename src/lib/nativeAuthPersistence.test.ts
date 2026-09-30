import { describe, expect, it } from 'vitest'
import { resolveNativePlatform, shouldUseBrowserLocalAuthPersistence } from './nativeAuthPersistence'

describe('Android auth persistence selection', () => {
  it('uses durable browser-local persistence for Android native builds', () => {
    expect(shouldUseBrowserLocalAuthPersistence('android')).toBe(true)
    expect(shouldUseBrowserLocalAuthPersistence(' ANDROID ')).toBe(true)
  })

  it('resolves Android from the Capacitor runtime when no build marker exists', () => {
    const platform = resolveNativePlatform(undefined, {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    })
    expect(platform).toBe('android')
    expect(shouldUseBrowserLocalAuthPersistence(platform)).toBe(true)
  })

  it('prefers an embedded build marker and leaves regular web unchanged', () => {
    expect(resolveNativePlatform('ios', { isNativePlatform: () => true, getPlatform: () => 'android' })).toBe('ios')
    expect(resolveNativePlatform(undefined, { isNativePlatform: () => false, getPlatform: () => 'android' })).toBe('')
    expect(shouldUseBrowserLocalAuthPersistence('ios')).toBe(false)
    expect(shouldUseBrowserLocalAuthPersistence('')).toBe(false)
  })
})
