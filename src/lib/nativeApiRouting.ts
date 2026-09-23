const NATIVE_QA_API_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'
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

export function rewriteNativeApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  assertNativeQaApiPathAllowed(input)
  return `${apiBase}${input}`
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

/**
 * Native iDogs QA runs against a dedicated public Vercel QA API project.
 * That project receives only staging Firebase credentials plus the
 * IDOGS_NATIVE_QA_BACKEND marker — no Stripe, Resend or SMS credentials.
 * CapacitorHttp patches fetch in the native shell to avoid WebView CORS.
 *
 * Safety contract:
 * - client build must use idogs-app-staging;
 * - dedicated backend health must report staging Firebase + dedicated-qa;
 * - billing/payment/outbound-message/super-admin endpoints are blocked locally;
 * - only relative /api/* paths are rewritten;
 * - no fallback to idogs.com.au or protected Preview deployments exists.
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

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return transportFetch(rewriteNativeApiUrl(input, apiBase), init)
    }
    if (input instanceof URL) {
      const raw = input.toString()
      return transportFetch(raw.startsWith('/api/') ? rewriteNativeApiUrl(raw, apiBase) : input, init)
    }
    return transportFetch(input, init)
  }) as typeof window.fetch

  document.documentElement.dataset.idogsNativeApi = 'dedicated-staging-qa'
  document.documentElement.dataset.idogsNativeExternalSideEffects = 'blocked'
}
