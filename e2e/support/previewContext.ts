import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Origin-bound Vercel Preview access (Codex harness finding #7077157877).
//
// Context-wide `extraHTTPHeaders` would attach the protection-bypass secret to EVERY request a
// page makes (third-party origins, redirects, signed Storage URLs). Instead the secret is sent
// exactly once, in a single non-redirecting request to the exact Preview origin, asking Vercel
// to set its bypass cookie. The browser then scopes that host-only cookie to the Preview host
// itself, for pages and for the context's request client alike, and never sends it elsewhere.
// No bypass header is configured on any context. Proven by preview-context-sentinel.spec.ts.

export const STAGING_PREVIEW = /^https:\/\/idogs-app-staging-[a-z0-9-]+\.vercel\.app\/?$/

export function assertStagingPreview(baseURL: string | undefined): string {
  const base = (baseURL || '').replace(/\/$/, '')
  expect(STAGING_PREVIEW.test(base), 'BASE_URL must be an idogs-app-staging Preview').toBe(true)
  return base
}

/** One request, no redirects followed, secret header only to `origin`; leaves a host-only cookie. */
export async function bootstrapPreviewCookie(request: APIRequestContext, origin: string, bypassSecret: string) {
  const res = await request.get(`${origin}/`, {
    headers: { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' },
    maxRedirects: 0, // never follow a redirect while the secret header is attached
    failOnStatusCode: false,
  })
  expect(res.status() < 500, 'Preview bypass bootstrap reached the Preview').toBe(true)
  const host = new URL(origin).hostname
  // Cookies the browser would send to this host: exact host, or a parent domain (e.g. .vercel.app).
  const applicable = (await request.storageState()).cookies.filter(c => {
    const d = c.domain.replace(/^\./, '')
    return host === d || host.endsWith(`.${d}`)
  })
  expect(applicable.length > 0, 'Preview bypass cookie was set').toBe(true)
  expect(applicable.every(c => c.domain === host), 'no parent-domain cookie: bypass cookie is host-only on the Preview host').toBe(true)
}

export async function createPreviewContext(browser: Browser, base: string, bypassSecret: string | undefined): Promise<BrowserContext> {
  // Explicit empty jar: no cookie inherited from config storageState or elsewhere.
  const context = await browser.newContext({ baseURL: base, storageState: { cookies: [], origins: [] } })
  if (bypassSecret) await bootstrapPreviewCookie(context.request, new URL(base).origin, bypassSecret)
  return context
}

/** Set a React-controlled input without the value appearing in step titles or action logs. */
export async function enterSecretly(page: Page, selector: string, value: string) {
  await page.locator(selector).first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}
