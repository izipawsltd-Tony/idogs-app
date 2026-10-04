import { describe, expect, it, vi } from 'vitest'
import {
  apiPathFromFetchInput,
  assertNativeProductionApiPathAllowed,
  assertNativeQaApiPathAllowed,
  assertNativeQaHealth,
  getNativeProductionApiBase,
  getNativeQaApiBase,
  installNativeProductionApiRouting,
  isFirestoreStreamRequest,
  nativeApiRoutablePath,
  rewriteNativeApiUrl,
  rewriteNativeProductionApiUrl,
  rewriteNativeQaApiUrl,
} from './nativeApiRouting'

const QA_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'
const PROD_BASE = 'https://idogs.com.au'
const NATIVE_SHELL_ORIGIN = 'https://localhost'

describe('native API routing', () => {
  it('preserves Firestore response streams while APIs and uploads retain native transport', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([49])); controller.close() } })
    const response = new Response(stream)
    const webFetch = vi.fn().mockResolvedValue(response)
    const nativeFetch = vi.fn().mockResolvedValue(new Response('{}'))
    const xhr = vi.fn()
    vi.stubGlobal('window', { fetch: nativeFetch, CapacitorWebFetch: webFetch, XMLHttpRequest: xhr, location: { origin: NATIVE_SHELL_ORIGIN } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    try {
      installNativeProductionApiRouting('idogs-app')
      const request = new Request('https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?RID=rpc')
      const init = { signal: new AbortController().signal }
      expect(await window.fetch(request, init)).toBe(response)
      expect(webFetch).toHaveBeenCalledWith(request, init)
      expect(nativeFetch).not.toHaveBeenCalled()
      expect(window.XMLHttpRequest).toBe(xhr)
      const apiInit = { method: 'POST', body: '{}', headers: { Authorization: 'Bearer qa-token' } }
      await window.fetch('/api/create-dog', apiInit)
      expect(nativeFetch).toHaveBeenLastCalledWith(`${PROD_BASE}/api/create-dog`, apiInit)
      const upload = new Request('https://storage.googleapis.com/api/signed-upload', { method: 'PUT', body: 'bytes' })
      await window.fetch(upload)
      expect(nativeFetch).toHaveBeenLastCalledWith(upload, undefined)
      expect(() => window.fetch('/api/create-checkout')).toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')
      expect(webFetch).toHaveBeenCalledTimes(1)
      expect(nativeFetch).toHaveBeenCalledTimes(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('only bypasses native HTTP for the exact HTTPS Firestore host', () => {
    for (const input of ['https://firestore.googleapis.com/v1/projects/test', new URL('https://firestore.googleapis.com/'), new Request('https://firestore.googleapis.com/')]) {
      expect(isFirestoreStreamRequest(input)).toBe(true)
    }
    for (const input of ['/api/create-dog', 'http://firestore.googleapis.com/', 'https://firestore.googleapis.com.attacker.example/', 'https://firestore.googleapis.com@attacker.example/', 'invalid', 'https://storage.googleapis.com/file']) {
      expect(isFirestoreStreamRequest(input)).toBe(false)
    }
  })

  it('uses the existing transport when no Capacitor original fetch is available', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('window', { fetch: transport, location: { origin: NATIVE_SHELL_ORIGIN } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    try {
      installNativeProductionApiRouting('idogs-app')
      await window.fetch('https://firestore.googleapis.com/v1/projects/test')
      expect(transport).toHaveBeenCalledWith('https://firestore.googleapis.com/v1/projects/test', undefined)
    } finally { vi.unstubAllGlobals() }
  })
  it('accepts only the staging Firebase project for QA', () => {
    expect(getNativeQaApiBase('idogs-app-staging')).toBe(QA_BASE)
    expect(() => getNativeQaApiBase('idogs-app')).toThrow('NATIVE_API_ENV_NOT_STAGING')
    expect(() => getNativeQaApiBase(undefined)).toThrow('NATIVE_API_ENV_NOT_STAGING')
  })

  it('accepts only the exact production Firebase project for production native', () => {
    expect(getNativeProductionApiBase('idogs-app')).toBe(PROD_BASE)
    for (const project of ['idogs-app-staging', 'any-production-project', 'idogs-app-copy', '', ' idogs-app', undefined]) {
      expect(() => getNativeProductionApiBase(project)).toThrow('NATIVE_API_ENV_NOT_PRODUCTION')
    }
  })

  it('does not enable production transport or markers when the Firebase project is wrong', () => {
    const fetch = vi.fn()
    const dataset = {}
    vi.stubGlobal('window', { fetch, location: { origin: NATIVE_SHELL_ORIGIN } })
    vi.stubGlobal('document', { documentElement: { dataset } })
    try {
      expect(() => installNativeProductionApiRouting('another-production-project'))
        .toThrow('NATIVE_API_ENV_NOT_PRODUCTION')
      expect(window.fetch).toBe(fetch)
      expect(fetch).not.toHaveBeenCalled()
      expect(dataset).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('treats an absolute iDogs API string identically to a URL/Request, so it cannot bypass the block list', () => {
    expect(nativeApiRoutablePath(`${PROD_BASE}/api/create-checkout`, PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/create-checkout')
    expect(() => rewriteNativeProductionApiUrl(
      nativeApiRoutablePath(`${PROD_BASE}/api/create-checkout`, PROD_BASE, NATIVE_SHELL_ORIGIN) ?? '',
      PROD_BASE,
    )).toThrow('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')

    // An absolute iDogs API string that isn't blocked still routes normally.
    expect(nativeApiRoutablePath(`${PROD_BASE}/api/claim-transferred-dogs`, PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBe('/api/claim-transferred-dogs')

    // An absolute third-party string with a coincidental /api/* path must
    // still pass through untouched, exactly like the URL/Request case above.
    expect(nativeApiRoutablePath('https://storage.googleapis.com/api/signed-upload?token=abc', PROD_BASE, NATIVE_SHELL_ORIGIN))
      .toBeNull()
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
