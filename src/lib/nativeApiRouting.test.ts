import { describe, expect, it } from 'vitest'
import {
  apiPathFromFetchInput,
  assertNativeProductionApiPathAllowed,
  assertNativeQaApiPathAllowed,
  assertNativeQaHealth,
  getNativeProductionApiBase,
  getNativeQaApiBase,
  nativeApiRoutablePath,
  rewriteNativeApiUrl,
  rewriteNativeProductionApiUrl,
  rewriteNativeQaApiUrl,
} from './nativeApiRouting'

const QA_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'
const PROD_BASE = 'https://idogs.com.au'
const NATIVE_SHELL_ORIGIN = 'https://localhost'

describe('native API routing', () => {
  it('accepts only the staging Firebase project for QA', () => {
    expect(getNativeQaApiBase('idogs-app-staging')).toBe(QA_BASE)
    expect(() => getNativeQaApiBase('idogs-app')).toThrow('NATIVE_API_ENV_NOT_STAGING')
    expect(() => getNativeQaApiBase(undefined)).toThrow('NATIVE_API_ENV_NOT_STAGING')
  })

  it('rejects staging or missing Firebase for production native', () => {
    expect(getNativeProductionApiBase('idogs-app')).toBe(PROD_BASE)
    expect(getNativeProductionApiBase('any-production-project')).toBe(PROD_BASE)
    expect(() => getNativeProductionApiBase('idogs-app-staging')).toThrow('NATIVE_API_ENV_NOT_PRODUCTION')
    expect(() => getNativeProductionApiBase(undefined)).toThrow('NATIVE_API_ENV_NOT_PRODUCTION')
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
      expect(() => rewriteNativeQaApiUrl(`${path}?qa=1`, QA_BASE))
        .toThrow('NATIVE_QA_EXTERNAL_SIDE_EFFECT_API_BLOCKED')
    }

    expect(() => assertNativeQaApiPathAllowed('/api/claim-transferred-dogs')).not.toThrow()
    expect(() => assertNativeQaApiPathAllowed('/api/create-litter')).not.toThrow()
    expect(() => assertNativeQaApiPathAllowed('/api/upload-document')).not.toThrow()
  })

  it('blocks external payment endpoints but keeps normal production APIs available in native production', () => {
    const blocked = [
      '/api/create-billing-portal',
      '/api/create-checkout',
      '/api/create-extra-litter-checkout',
      '/api/create-sms-addon-checkout',
      '/api/enforce-billing-grace',
      '/api/stripe-webhook',
    ]

    for (const path of blocked) {
      expect(() => assertNativeProductionApiPathAllowed(path))
        .toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')
      expect(() => rewriteNativeProductionApiUrl(`${path}?native=1`, PROD_BASE))
        .toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')
    }

    expect(rewriteNativeProductionApiUrl('/api/billing-summary', PROD_BASE))
      .toBe(`${PROD_BASE}/api/billing-summary`)
    expect(rewriteNativeProductionApiUrl('/api/claim-transferred-dogs?mode=check', PROD_BASE))
      .toBe(`${PROD_BASE}/api/claim-transferred-dogs?mode=check`)
    expect(rewriteNativeProductionApiUrl('https://storage.googleapis.com/signed-upload', PROD_BASE))
      .toBe('https://storage.googleapis.com/signed-upload')
  })

  it('extracts a matchable /api/* path from string, URL, and Request fetch inputs alike', () => {
    expect(apiPathFromFetchInput('/api/create-checkout?x=1')).toBe('/api/create-checkout?x=1')
    expect(apiPathFromFetchInput(new URL('/api/create-checkout', PROD_BASE))).toBe('/api/create-checkout')
    expect(apiPathFromFetchInput(new Request(`${PROD_BASE}/api/create-extra-litter-checkout`)))
      .toBe('/api/create-extra-litter-checkout')
    expect(apiPathFromFetchInput(new URL('https://storage.googleapis.com/signed-upload')))
      .toBe('/signed-upload')
  })

  it('still blocks native production payment endpoints requested via URL or Request objects, not just plain strings', () => {
    const blockedViaUrl = new URL('/api/create-checkout', PROD_BASE)
    const blockedViaRequest = new Request(`${PROD_BASE}/api/create-extra-litter-checkout`, { method: 'POST' })

    expect(() => rewriteNativeProductionApiUrl(apiPathFromFetchInput(blockedViaUrl), PROD_BASE))
      .toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')
    expect(() => rewriteNativeProductionApiUrl(apiPathFromFetchInput(blockedViaRequest), PROD_BASE))
      .toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')

    const allowedViaUrl = new URL('/api/claim-transferred-dogs', PROD_BASE)
    expect(rewriteNativeProductionApiUrl(apiPathFromFetchInput(allowedViaUrl), PROD_BASE))
      .toBe(`${PROD_BASE}/api/claim-transferred-dogs`)
  })

  it('lets a bare relative /api/* string through as routable, and any other bare string through untouched', () => {
    expect(nativeApiRoutablePath('/api/create-checkout?x=1', PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/create-checkout?x=1')
    expect(nativeApiRoutablePath('/app/dashboard', PROD_BASE, NATIVE_SHELL_ORIGIN)).toBeNull()
    expect(nativeApiRoutablePath('https://storage.googleapis.com/signed-upload', PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBeNull()
  })

  it('passes an absolute third-party URL/Request through untouched, even with a coincidental /api/* path', () => {
    const thirdPartyUrl = new URL('https://storage.googleapis.com/api/signed-upload?token=abc')
    expect(nativeApiRoutablePath(thirdPartyUrl, QA_BASE, NATIVE_SHELL_ORIGIN)).toBeNull()
    expect(nativeApiRoutablePath(thirdPartyUrl, PROD_BASE, NATIVE_SHELL_ORIGIN)).toBeNull()

    const thirdPartyRequest = new Request('https://storage.googleapis.com/api/signed-upload', {
      method: 'PUT',
      body: 'file-bytes',
    })
    expect(nativeApiRoutablePath(thirdPartyRequest, QA_BASE, NATIVE_SHELL_ORIGIN)).toBeNull()
  })

  it('treats same-origin (native shell) and explicit iDogs API origins as routable, regardless of which base is active', () => {
    // Same-origin absolute URL, as `new Request('/api/...')` would normalize to.
    expect(nativeApiRoutablePath(new URL('/api/create-checkout', NATIVE_SHELL_ORIGIN), QA_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/create-checkout')

    // Explicit production origin must stay routable even while QA is the active apiBase,
    // so an absolute iDogs checkout URL cannot bypass the payment block just by being
    // spelled out in full instead of as a relative path.
    expect(nativeApiRoutablePath(new URL(`${PROD_BASE}/api/create-checkout`), QA_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/create-checkout')

    // Explicit QA origin must stay routable even while production is the active apiBase.
    expect(nativeApiRoutablePath(new Request(`${QA_BASE}/api/claim-transferred-dogs`), PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/claim-transferred-dogs')
  })

  it('still blocks a same-origin or explicit-iDogs-origin payment path delivered as an absolute URL/Request', () => {
    expect(() => rewriteNativeProductionApiUrl(
      nativeApiRoutablePath(new URL(`${PROD_BASE}/api/create-checkout`), PROD_BASE, NATIVE_SHELL_ORIGIN) ?? '',
      PROD_BASE,
    )).toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')

    expect(() => rewriteNativeQaApiUrl(
      nativeApiRoutablePath(new Request(`${QA_BASE}/api/send-sms`), QA_BASE, NATIVE_SHELL_ORIGIN) ?? '',
      QA_BASE,
    )).toThrow('NATIVE_QA_EXTERNAL_SIDE_EFFECT_API_BLOCKED')
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
