import { describe, expect, it } from 'vitest'
import { getNativeProductionApiBase, rewriteNativeProductionApiUrl } from './nativeProductionApiRouting'

describe('native production API routing', () => {
  it('requires the known production Firebase project', () => {
    expect(getNativeProductionApiBase('idogs-app')).toBe('https://idogs.com.au')
    expect(() => getNativeProductionApiBase('idogs-app-staging')).toThrow('NATIVE_PRODUCTION_FIREBASE_MISMATCH')
    expect(() => getNativeProductionApiBase(undefined)).toThrow('NATIVE_PRODUCTION_FIREBASE_MISMATCH')
  })

  it('rewrites only relative API requests to the pinned production domain', () => {
    const base = getNativeProductionApiBase('idogs-app')
    expect(rewriteNativeProductionApiUrl('/api/billing-summary?x=1', base)).toBe(`${base}/api/billing-summary?x=1`)
    expect(rewriteNativeProductionApiUrl('https://example.com/api/x', base)).toBe('https://example.com/api/x')
    expect(() => rewriteNativeProductionApiUrl('/api/x', 'https://idogs-native-api-qa-izipaws.vercel.app'))
      .toThrow('NATIVE_PRODUCTION_API_MISMATCH')
  })
})
