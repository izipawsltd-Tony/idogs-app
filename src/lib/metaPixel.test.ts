import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { canMeasureMarketingPage, META_CONSENT_KEY, META_PIXEL_ID, readMetaConsent, setMetaConsent, suspendMetaTracking, trackCompletedRegistration, trackMarketingPage } from './metaPixel'

let stored: Map<string, string>
let append: ReturnType<typeof vi.fn>
beforeEach(() => {
  stored = new Map()
  append = vi.fn()
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { hostname: 'idogs.com.au', pathname: '/', search: '' })
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
  vi.stubGlobal('document', { head: { appendChild: append }, createElement: () => ({}), cookie: '' })
  setMetaConsent('denied')
})
afterEach(() => vi.unstubAllGlobals())
describe('Meta acquisition measurement', () => {
  it('makes no request before consent or after declining', () => {
    stored.clear()
    expect(readMetaConsent()).toBe(null)
    trackMarketingPage(); trackCompletedRegistration()
    expect(append).not.toHaveBeenCalled()
    setMetaConsent('denied'); trackMarketingPage()
    expect(append).not.toHaveBeenCalled()
  })
  it('loads one SDK and records one page view despite repeated effects', () => {
    setMetaConsent('granted'); trackMarketingPage(); trackMarketingPage()
    expect(append).toHaveBeenCalledTimes(1)
    const fbq = (window as any).fbq
    expect(fbq.queue.filter((a: unknown[]) => a[2] === 'PageView')).toEqual([['trackSingle', META_PIXEL_ID, 'PageView']])
    expect(fbq.queue[0]).toEqual(['set', 'autoConfig', false, META_PIXEL_ID])
    location.pathname = '/signup'; trackMarketingPage()
    trackCompletedRegistration()
    expect(fbq.queue.filter((a: unknown[]) => a[2] === 'CompleteRegistration')).toEqual([['trackSingle', META_PIXEL_ID, 'CompleteRegistration', { status: true }]])
  })
  it.each(['/app/dogs/private-id', '/app/billing', '/p/private-id', '/s/private-token', '/verify-email', '/login', '/super-admin'])('never measures %s', path => {
    location.pathname = path
    setMetaConsent('granted'); trackMarketingPage(); trackCompletedRegistration()
    expect(append).not.toHaveBeenCalled()
  })
  it('excludes preview hosts, native apps and unknown query parameters', () => {
    location.hostname = 'idogs-preview.vercel.app'; expect(canMeasureMarketingPage()).toBe(false)
    location.hostname = 'idogs.com.au'; (window as any).Capacitor = { isNativePlatform: () => true }
    expect(canMeasureMarketingPage()).toBe(false)
    delete (window as any).Capacitor
    location.search = '?email=private@example.invalid'; expect(canMeasureMarketingPage()).toBe(false)
    location.search = '?next=%2Fapp%2Fdogs%2Fprivate-id'; expect(canMeasureMarketingPage()).toBe(false)
    location.search = '?next=%2Fapp%2Fbilling'; expect(canMeasureMarketingPage()).toBe(true)
  })
  it('revokes on private routes and discards unsent events when consent is withdrawn', () => {
    setMetaConsent('granted'); trackMarketingPage()
    const fbq = (window as any).fbq
    location.pathname = '/app/dashboard'; suspendMetaTracking()
    expect(fbq.queue.at(-1)).toEqual(['consent', 'revoke'])
    setMetaConsent('denied')
    expect(fbq.queue.some((a: unknown[]) => a[0] === 'trackSingle')).toBe(false)
    expect(fbq.queue.at(-1)).toEqual(['consent', 'revoke'])
    expect(stored.get(META_CONSENT_KEY)).toBe('denied')
  })
})
