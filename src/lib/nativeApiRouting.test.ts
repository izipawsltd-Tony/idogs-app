import { describe, expect, it } from 'vitest'
import {
  assertNativeQaApiPathAllowed,
  assertNativeQaHealth,
  getNativeQaApiBase,
  rewriteNativeApiUrl,
} from './nativeApiRouting'

const QA_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'

describe('native API routing', () => {
  it('accepts only the staging Firebase project', () => {
    expect(getNativeQaApiBase('idogs-app-staging')).toBe(QA_BASE)
    expect(() => getNativeQaApiBase('idogs-app')).toThrow('NATIVE_API_ENV_NOT_STAGING')
    expect(() => getNativeQaApiBase(undefined)).toThrow('NATIVE_API_ENV_NOT_STAGING')
  })

  it('rewrites only relative iDogs API paths', () => {
    expect(rewriteNativeApiUrl('/api/claim-transferred-dogs?mode=check', QA_BASE))
      .toBe(`${QA_BASE}/api/claim-transferred-dogs?mode=check`)
    expect(rewriteNativeApiUrl('/app/dashboard', QA_BASE)).toBe('/app/dashboard')
    expect(rewriteNativeApiUrl('https://storage.googleapis.com/signed-upload', QA_BASE))
      .toBe('https://storage.googleapis.com/signed-upload')
  })

  it('blocks payment, billing, outbound communication and super-admin APIs in native QA', () => {
    const blocked = [
      '/api/billing-summary',
      '/api/create-billing-portal',
      '/api/create-checkout',
      '/api/create-extra-litter-checkout',
      '/api/create-sms-addon-checkout',
      '/api/remove-sms-addon',
      '/api/send-email',
      '/api/send-reminders',
      '/api/send-sms',
      '/api/create-showcase-enquiry',
      '/api/enforce-billing-grace',
      '/api/stripe-webhook',
      '/api/super-admin/subscriptions',
    ]

    for (const path of blocked) {
      expect(() => assertNativeQaApiPathAllowed(path))
        .toThrow('NATIVE_QA_EXTERNAL_SIDE_EFFECT_API_BLOCKED')
      expect(() => rewriteNativeApiUrl(`${path}?qa=1`, QA_BASE))
        .toThrow('NATIVE_QA_EXTERNAL_SIDE_EFFECT_API_BLOCKED')
    }

    expect(() => assertNativeQaApiPathAllowed('/api/claim-transferred-dogs')).not.toThrow()
    expect(() => assertNativeQaApiPathAllowed('/api/create-litter')).not.toThrow()
    expect(() => assertNativeQaApiPathAllowed('/api/upload-document')).not.toThrow()
  })

  it('requires dedicated QA backend mode and staging Admin Firebase', () => {
    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app-staging',
      vercelEnv: 'production',
      backendMode: 'dedicated-qa',
    })).not.toThrow()

    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app',
      vercelEnv: 'production',
      backendMode: 'dedicated-qa',
    })).toThrow('NATIVE_API_BACKEND_NOT_STAGING')

    expect(() => assertNativeQaHealth({
      ok: true,
      firebaseProjectId: 'idogs-app-staging',
      vercelEnv: 'preview',
      backendMode: 'branch-preview',
    })).toThrow('NATIVE_API_BACKEND_NOT_STAGING')
  })
})
