const NATIVE_QA_API_BASE = 'https://idogs-app-git-feat-mobile-app-3024f6-izipawsltd-tonys-projects.vercel.app'
const EXPECTED_STAGING_FIREBASE_PROJECT = 'idogs-app-staging'
const EXPECTED_VERCEL_ENV = 'preview'
const EXPECTED_BRANCH = 'feat/mobile-app-foundation'

export type NativeQaHealth = {
  ok?: unknown
  firebaseProjectId?: unknown
  vercelEnv?: unknown
  branch?: unknown
}

export function getNativeQaApiBase(firebaseProjectId: string | undefined): string {
  if (firebaseProjectId !== EXPECTED_STAGING_FIREBASE_PROJECT) {
    throw new Error('NATIVE_API_ENV_NOT_STAGING')
  }
  return NATIVE_QA_API_BASE
}

export function rewriteNativeApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  return `${apiBase}${input}`
}

export function assertNativeQaHealth(value: NativeQaHealth): void {
  if (
    value.ok !== true ||
    value.firebaseProjectId !== EXPECTED_STAGING_FIREBASE_PROJECT ||
    value.vercelEnv !== EXPECTED_VERCEL_ENV ||
    value.branch !== EXPECTED_BRANCH
  ) {
    throw new Error('NATIVE_API_BACKEND_NOT_STAGING')
  }
}

/**
 * Native iDogs QA is served from the local Capacitor origin, so browser-style
 * relative /api/* URLs cannot reach Vercel. CapacitorHttp patches window.fetch
 * in the native shell (mobile/capacitor.config.ts), which lets us use native
 * transport without WebView CORS. We keep every existing web call unchanged
 * and only rewrite relative /api/* calls when this explicit staging bootstrap
 * succeeds.
 *
 * Safety contract:
 * - native QA must be built with the staging Firebase project;
 * - the backend must be the fixed feature-branch Preview alias;
 * - the backend health endpoint must independently report Preview + staging;
 * - no fallback to idogs.com.au or another origin is allowed.
 */
export async function installNativeQaApiRouting(firebaseProjectId: string | undefined): Promise<void> {
  const apiBase = getNativeQaApiBase(firebaseProjectId)
  const transportFetch = window.fetch.bind(window)

  const healthResponse = await transportFetch(`${apiBase}/api/native-qa-health`, {
    method: 'GET',
    cache: 'no-store',
    headers: { 'X-iDogs-Native-QA': '1' },
  })
  if (!healthResponse.ok) {
    throw new Error('NATIVE_API_BACKEND_HEALTH_FAILED')
  }

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
    // Existing iDogs API calls use string /api/* paths. Request objects are
    // deliberately left untouched so signed upload/external requests cannot
    // be accidentally redirected through the iDogs backend.
    return transportFetch(input, init)
  }) as typeof window.fetch

  document.documentElement.dataset.idogsNativeApi = 'staging-preview'
}
