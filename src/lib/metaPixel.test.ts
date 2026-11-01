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
  it.each(['/app/dogs/private-id', '/app/billing', '/p/private-id', '/s/private-token', '/verify-email', '/super-admin', '/auth/finish'])('never measures %s', path => {
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

describe('Signup attribution fixes (directive 6564223316)', () => {
  it('accepts standard Meta / UTM ad parameters such as utm_id and ad_id', () => {
    location.search = '?fbclid=abc&utm_source=facebook&utm_id=120&campaign_id=1&adset_id=2&ad_id=3&placement=Instagram_Stories&site_source_name=ig'
    expect(canMeasureMarketingPage()).toBe(true)
  })
  it('still refuses any unknown or personal query key', () => {
    for (const q of ['?email=a@b.co', '?phone=0400000000', '?utm_id=1&token=x', '?gclid=1']) {
      location.search = q; expect(canMeasureMarketingPage()).toBe(false)
    }
  })
  it('/login: no PageView, but a brand-new account records CompleteRegistration after consent', async () => {
    location.pathname = '/login'; location.search = '?next=%2Fapp%2Fdashboard'
    setMetaConsent('granted'); trackMarketingPage()
    expect(append).not.toHaveBeenCalled()
    const done = trackCompletedRegistration(100)
    const fbq = (window as any).fbq
    expect(fbq.queue.filter((a: unknown[]) => a[2] === 'CompleteRegistration')).toHaveLength(1)
    expect(fbq.queue.some((a: unknown[]) => a[2] === 'PageView')).toBe(false)
    await done
  })
  it('/login without consent: nothing loaded, resolves immediately', async () => {
    location.pathname = '/login'; stored.clear()
    await trackCompletedRegistration(5000)
    expect(append).not.toHaveBeenCalled()
  })
  it('waits for the SDK before resolving, so navigation cannot discard the event', async () => {
    vi.useFakeTimers()
    try {
      location.pathname = '/signup'; setMetaConsent('granted')
      let resolved = false
      const done = trackCompletedRegistration(1500).then(() => { resolved = true })
      await vi.advanceTimersByTimeAsync(200); expect(resolved).toBe(false)
      ;(window as any).fbq.callMethod = () => {}  // SDK finished loading
      await vi.advanceTimersByTimeAsync(60); await done; expect(resolved).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('never waits longer than the timeout when the SDK is blocked', async () => {
    vi.useFakeTimers()
    try {
      location.pathname = '/signup'; setMetaConsent('granted')
      let resolved = false
      const done = trackCompletedRegistration(1500).then(() => { resolved = true })
      await vi.advanceTimersByTimeAsync(1600); await done; expect(resolved).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('/login on a preview host or in the native app records nothing', async () => {
    location.pathname = '/login'; setMetaConsent('granted')
    location.hostname = 'idogs-app-staging-x.vercel.app'; await trackCompletedRegistration(10)
    location.hostname = 'idogs.com.au'; (window as any).Capacitor = { isNativePlatform: () => true }; await trackCompletedRegistration(10)
    expect(append).not.toHaveBeenCalled()
  })
})

describe('root cause evidence', () => {
  it('without waiting, navigating into the app discards a CompleteRegistration the SDK has not sent yet', () => {
    location.pathname = '/signup'; setMetaConsent('granted')
    void trackCompletedRegistration(1)          // old callers did not await
    location.pathname = '/app/dashboard'; suspendMetaTracking()
    expect((window as any).fbq.queue.some((a: unknown[]) => a[2] === 'CompleteRegistration')).toBe(false)
  })
})
