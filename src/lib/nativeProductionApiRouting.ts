const PRODUCTION_API_BASE = 'https://idogs.com.au'
const PRODUCTION_FIREBASE_PROJECT = 'idogs-app'

export function getNativeProductionApiBase(firebaseProjectId: string | undefined): string {
  if (firebaseProjectId !== PRODUCTION_FIREBASE_PROJECT) {
    throw new Error('NATIVE_PRODUCTION_FIREBASE_MISMATCH')
  }
  return PRODUCTION_API_BASE
}

export function rewriteNativeProductionApiUrl(input: string, apiBase: string): string {
  if (!input.startsWith('/api/')) return input
  if (apiBase !== PRODUCTION_API_BASE) throw new Error('NATIVE_PRODUCTION_API_MISMATCH')
  return `${apiBase}${input}`
}

export function installNativeProductionApiRouting(firebaseProjectId: string | undefined): void {
  const apiBase = getNativeProductionApiBase(firebaseProjectId)
  const transportFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return transportFetch(rewriteNativeProductionApiUrl(input, apiBase), init)
    }
    return transportFetch(input, init)
  }) as typeof window.fetch
  const transportOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const destination = typeof url === 'string'
      ? rewriteNativeProductionApiUrl(url, apiBase)
      : url
    return transportOpen.call(this, method, destination, ...rest as [boolean, string?, string?])
  } as typeof XMLHttpRequest.prototype.open
  document.documentElement.dataset.idogsNativeApi = 'production'
}
