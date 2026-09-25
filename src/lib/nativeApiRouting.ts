const NATIVE_QA_API_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'
const NATIVE_PRODUCTION_API_BASE = 'https://idogs.com.au'
const EXPECTED_STAGING_FIREBASE_PROJECT = 'idogs-app-staging'
const EXPECTED_VERCEL_ENV = 'production'
const EXPECTED_BACKEND_MODE = 'dedicated-qa'

const NATIVE_QA_BLOCKED_API_PATHS = new Set([
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
])

// Google Play production builds must not expose Stripe purchase/portal flows
// for digital services inside the Android app. Read-only billing state can
// still be fetched, but purchase/portal endpoints are blocked locally before
// a request can leave the device. Web billing at idogs.com.au is unchanged.
const NATIVE_PRODUCTION_BLOCKED_API_PATHS = new Set([
  '/api/create-billing-portal',
  '/api/create-checkout',
  '/api/create-extra-litter-checkout',
  '/api/create-sms-addon-checkout',
  '/api/enforce-billing-grace',
  '/api/stripe-webhook',
])

export type NativeQaHealth = {
  ok?: unknown
  firebaseProjectId?: unknown
  vercelEnv?: unknown
  branch?: unknown
  backendMode?: unknown
}

export function getNativeQaApiBase(firebaseProjectId: string | undefined): string {
  if (firebaseProjectId !== EXPECTED_STAGING_FIREBASE_PROJECT) {
    throw new Error('NATIVE_API_ENV_NOT_STAGING')
  }
  return NATIVE_QA_API_BASE
}

export function getNativeProductionApiBase(firebaseProjectId: string | undefined): string {
  if (!firebaseProjectId || firebaseProjectId === EXPECTED_STAGING_FIREBASE_PROJECT) {
    throw new Error('NATIVE_API_ENV_NOT_PRODUCTION')
  }
  return NATIVE_PRODUCTION_API_BASE
}

function relativeApiPath(input: string): string {
  return input.split(/[?#]/, 1)[0]
}

export function assertNativeQaApiPathAllowed(input: string): void {
  if (!input.startsWith('/api/')) return
  const path = relativeApiPath(input)
  if (NATIVE_QA_BLOCKED_API_PATHS.has(path) || path.startsWith('/api/super-admin/')) {
    throw new Error('NATIVE_QA_EXTERNAL_SIDE_EFFECT_API_BLOCKED')
  }
}

export function assertNativeProductionApiPathAllowed(input: string): void {
  if (!input.startsWith('/api/')) return
  const path = relativeApiPath(input)
  if (NATIVE_PRODUCTION_BLOCKED_API_PATHS.has(path)) {
    throw new Error('NATIVE_PRODUCTION_EXTERNAL_PAYMENT_API_BLOCKED')
  }
}

export function rewriteNativeApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  return `${apiBase}${input}`
}

export function rewriteNativeQaApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  assertNativeQaApiPathAllowed(input)
  return rewriteNativeApiUrl(input, apiBase)
}

export function rewriteNativeProductionApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  assertNativeProductionApiPathAllowed(input)
  return rewriteNativeApiUrl(input, apiBase)
}

export function assertNativeQaHealth(value: NativeQaHealth): void {
  if (
    value.ok !== true ||
    value.firebaseProjectId !== EXPECTED_STAGING_FIREBASE_PROJECT ||
    value.vercelEnv !== EXPECTED_VERCEL_ENV ||
    value.backendMode !== EXPECTED_BACKEND_MODE
  ) {
    throw new Error('NATIVE_API_BACKEND_NOT_STAGING')
  }
}

function installFetchRouter(
  apiBase: string,
  rewrite: (input: string, apiBase: string) => string,
): void {
  const transportFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return transportFetch(rewrite(input, apiBase), init)
    }
    if (input instanceof URL) {
      return transportFetch(input, init)
    }
    return transportFetch(input, init)
  }) as typeof window.fetch
}

/**
 * Native iDogs QA runs against a dedicated public Vercel QA API project.
 * It fail-closes on staging backend health and blocks all external side-effect
 * APIs used for payments/outbound messages/admin operations.
 */
export async function installNativeQaApiRouting(firebaseProjectId: string | undefined): Promise<void> {
  const apiBase = getNativeQaApiBase(firebaseProjectId)
  const transportFetch = window.fetch.bind(window)

  const healthResponse = await transportFetch(`${apiBase}/api/native-qa-health`, {
    method: 'GET',
    cache: 'no-store',
    headers: { 'X-iDogs-Native-QA': '1' },
  })
  if (!healthResponse.ok) throw new Error('NATIVE_API_BACKEND_HEALTH_FAILED')

  const health = await healthResponse.json().catch(() => null) as NativeQaHealth | null
  if (!health) throw new Error('NATIVE_API_BACKEND_HEALTH_INVALID')
  assertNativeQaHealth(health)

  installFetchRouter(apiBase, rewriteNativeQaApiUrl)
  document.documentElement.dataset.idogsNativeApi = 'dedicated-staging-qa'
  document.documentElement.dataset.idogsNativeExternalSideEffects = 'blocked'
}

/**
 * Production Android uses the public production iDogs API origin. The build
 * pipeline injects Firebase client configuration from Vercel production and
 * this guard rejects staging before React/Auth can start. Stripe purchase and
 * billing-portal endpoints are blocked locally for Google Play compliance;
 * production web billing remains unchanged.
 */
export function installNativeProductionApiRouting(firebaseProjectId: string | undefined): void {
  const apiBase = getNativeProductionApiBase(firebaseProjectId)
  installFetchRouter(apiBase, rewriteNativeProductionApiUrl)
  document.documentElement.dataset.idogsNativeApi = 'production'
  document.documentElement.dataset.idogsNativeExternalPayments = 'blocked'
}
