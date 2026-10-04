const NATIVE_QA_API_BASE = 'https://idogs-native-api-qa-izipaws.vercel.app'
const NATIVE_PRODUCTION_API_BASE = 'https://idogs.com.au'
const EXPECTED_STAGING_FIREBASE_PROJECT = 'idogs-app-staging'
const EXPECTED_PRODUCTION_FIREBASE_PROJECT = 'idogs-app'
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
  if (firebaseProjectId !== EXPECTED_PRODUCTION_FIREBASE_PROJECT) {
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

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

// An absolute URL/Request whose origin is some third party (e.g. a signed
// upload host) must never be treated as a native `/api/*` call: stripping
// its origin down to a bare pathname would let a coincidental `/api/...`
// path get silently rewritten onto the iDogs API host, sending that
// request's body/auth to the wrong server. Only a bare relative string, or
// an absolute URL/Request whose origin is the native shell's own origin or
// one of the known iDogs API origins (QA or production, regardless of which
// one is currently active), is eligible for rewrite/block-list checks — the
// latter also ensures an absolute iDogs URL can't bypass the payment block
// just by being spelled out in full instead of as a relative path.
export function nativeApiRoutablePath(
  input: RequestInfo | URL,
  apiBase: string,
  currentOrigin: string,
): string | null {
  const eligibleOrigins = [currentOrigin, apiBase, NATIVE_PRODUCTION_API_BASE, NATIVE_QA_API_BASE]
    .map(safeOrigin)
    .filter((origin): origin is string => origin !== null)

  if (typeof input === 'string') {
    // A bare relative string (e.g. `/api/create-checkout`) has no origin of
    // its own, so `safeOrigin` returns null for it — fall back to the plain
    // `/api/` prefix check. An absolute string must go through the same
    // eligible-origin check as a URL/Request below, otherwise spelling a
    // blocked iDogs endpoint out in full as a string (instead of passing a
    // URL/Request) would silently bypass the block list.
    const absoluteOrigin = safeOrigin(input)
    if (absoluteOrigin === null) return input.startsWith('/api/') ? input : null
    if (!eligibleOrigins.includes(absoluteOrigin)) return null
    const absoluteUrl = new URL(input)
    return absoluteUrl.pathname + absoluteUrl.search + absoluteUrl.hash
  }

  let absoluteUrl: URL
  try {
    absoluteUrl = input instanceof URL ? input : new URL(input.url)
  } catch {
    return null
  }

  if (!eligibleOrigins.includes(absoluteUrl.origin)) return null
  return absoluteUrl.pathname + absoluteUrl.search + absoluteUrl.hash
}

// Request instances always normalize `.url` to an absolute URL, and a caller
// could equally pass a URL instance instead of a bare string. Recovering just
// the path here means assert/rewrite's `/api/` matching applies the same way
// no matter which of the three RequestInfo|URL shapes a fetch call used.
export function apiPathFromFetchInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.pathname + input.search + input.hash
  try {
    const url = new URL(input.url)
    return url.pathname + url.search + url.hash
  } catch {
    return input.url
  }
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
  // CapacitorHttp buffers/proxies remote requests. Firestore's WebChannel
  // requires incremental response chunks and must use the original WebView
  // fetch. Keep native HTTP for iDogs APIs and signed uploads, not Firestore.
  const webFetch = (window as Window & { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch
  const firestoreFetch = webFetch?.bind(window) ?? transportFetch
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isFirestoreStreamRequest(input)) return firestoreFetch(input, init)
    const path = nativeApiRoutablePath(input, apiBase, window.location.origin)
    // A third-party absolute URL/Request (not same-origin, not a known iDogs
    // API origin) is left completely untouched here. rewrite() throws for a
    // blocked native /api/* path once we do have an eligible path, so this
    // still rejects a blocked call regardless of whether it arrived as a
    // string, a URL, or a Request — closing the bypass a
    // `typeof input === 'string'` check alone would leave open.
    if (path === null) return transportFetch(input, init)
    const rewritten = rewrite(path, apiBase)
    if (rewritten === path) return transportFetch(input, init)
    if (input instanceof Request) return transportFetch(new Request(rewritten, input), init)
    return transportFetch(rewritten, init)
  }) as typeof window.fetch
}

export function isFirestoreStreamRequest(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return url.protocol === 'https:' && url.hostname === 'firestore.googleapis.com'
  } catch {
    return false
  }
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
