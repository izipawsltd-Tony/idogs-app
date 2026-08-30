import { PLUS_MONTHLY_PRICE_AUD, PLUS_ANNUAL_PRICE_AUD } from './pricingCopy'

type MetaFbq = (...args: unknown[]) => void

type WindowWithFbq = Window & {
  fbq?: MetaFbq
}

function getCheckoutValue(body: BodyInit | null | undefined): number | null {
  if (typeof body !== 'string') return null
  try {
    const parsed = JSON.parse(body) as { plan?: string }
    if (parsed.plan === 'plus_monthly') return PLUS_MONTHLY_PRICE_AUD
    if (parsed.plan === 'plus_annual') return PLUS_ANNUAL_PRICE_AUD
  } catch {
    return null
  }
  return null
}

export function installMetaInitiateCheckoutTracking() {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (requestUrl === '/api/create-checkout' && init?.method === 'POST' && response.ok) {
      const body = await response.clone().json().catch(() => null) as { url?: unknown } | null
      if (typeof body?.url === 'string' && body.url.length > 0) {
        const fbq = (window as WindowWithFbq).fbq
        const value = getCheckoutValue(init.body)
        if (typeof fbq === 'function') {
          fbq('track', 'InitiateCheckout', {
            currency: 'AUD',
            ...(value !== null ? { value } : {}),
          })
        }
      }
    }

    return response
  }
}
