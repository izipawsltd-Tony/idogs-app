import { describe, expect, it } from 'vitest'
import { assertNativeQaHealth, getNativeQaApiBase, rewriteNativeApiUrl } from './nativeApiRouting'

const QA_BASE = 'https://idogs-app-git-feat-mobile-app-3024f6-izipawsltd-tonys-projects.vercel.app'

describe('native API routing', () => {
  it('accepts only the staging Firebase project', () => {
    expect(getNativeQaApiBase('idogs-app-staging')).toBe(QA_BASE)
    expect(() => getNativeQaApiBase('idogs-app')).toThrow('NATIVE_API_ENV_NOT_STAGING')
    expect(() => getNativeQaApiBase(undefined)).toThrow('NATIVE_API_ENV_NOT_STAGING')
  })

  it('rewrites only relative iDogs API paths', () => {
    expect(rewriteNativeApiUrl('/api/claim-transferred-dogs', QA_BASE))
      .toBe(`${QA_BASE}/api/claim-transferred-dogs`)
    expect(rewriteNativeApiUrl('/app/dashboard', QA_BASE)).toBe('/app/dashboard')
    expect(rewriteNativeApiUrl('https://storage.googleapis.com/signed-upload', QA_BASE))
      .toBe('https://storage.googleapis.com/signed-upload')
  })

  it('requires Preview branch and staging Admin Firebase health', () => {
    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app-staging',
      vercelEnv: 'preview',
      branch: 'feat/mobile-app-foundation',
    })).not.toThrow()

    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app',
      vercelEnv: 'preview',
      branch: 'feat/mobile-app-foundation',
    })).toThrow('NATIVE_API_BACKEND_NOT_STAGING')

    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app-staging',
      vercelEnv: 'production',
      branch: 'master',
    })).toThrow('NATIVE_API_BACKEND_NOT_STAGING')
  })
})
