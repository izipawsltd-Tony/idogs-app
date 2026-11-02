import { beforeEach, expect, it, vi } from 'vitest'
import { ACQUISITION_KEY, captureAcquisition, parseAcquisition, signupAcquisition } from './acquisition'
const store = new Map<string, string>()
beforeEach(() => { store.clear(); vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }) })
const AD = '?fbclid=SECRETCLICKID&utm_source=facebook&utm_medium=paid&utm_campaign=Puppy%20Owners%20Nov&utm_content=reel-1&utm_id=120&ad_id=3&adset_id=2&campaign_id=1&placement=Instagram_Stories'

it('keeps ad metadata only and never stores the fbclid value', () => {
  const a = parseAcquisition(AD, '/')!
  expect(a).toMatchObject({ source: 'facebook', medium: 'paid', campaign: 'Puppy Owners Nov', content: 'reel-1', utmId: '120', adId: '3', adsetId: '2', campaignId: '1', placement: 'Instagram_Stories', fbclid: true, landingPath: '/' })
  expect(JSON.stringify(a)).not.toContain('SECRETCLICKID')
})
it('ignores non-ad parameters such as email, and returns null for an organic visit', () => {
  expect(parseAcquisition('?email=a@b.c&next=/app', '/signup')).toBeNull()
  expect(JSON.stringify(parseAcquisition('?utm_source=facebook&email=a@b.c', '/signup'))).not.toContain('a@b.c')
})
it('strips markup and caps length', () => {
  const a = parseAcquisition('?utm_campaign=' + encodeURIComponent('<script>x</script>' + 'y'.repeat(300)), '/')!
  expect(a.campaign).not.toMatch(/[<>]/); expect(a.campaign!.length).toBeLessThanOrEqual(100)
})
it('first touch wins; later visits do not overwrite it', () => {
  captureAcquisition('?utm_source=facebook&utm_campaign=first', '/')
  captureAcquisition('?utm_source=google&utm_campaign=second', '/signup')
  expect(signupAcquisition()).toMatchObject({ source: 'facebook', campaign: 'first' })
})
it('signup without an ad visit is recorded as direct; stale (>30 days) attribution expires', () => {
  expect(signupAcquisition()).toEqual({ source: 'direct', version: 1 })
  store.set(ACQUISITION_KEY, JSON.stringify({ ...parseAcquisition('?utm_source=facebook', '/'), firstSeenAt: '2020-01-01T00:00:00.000Z' }))
  expect(signupAcquisition()).toEqual({ source: 'direct', version: 1 })
})
it('never throws when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  expect(() => captureAcquisition(AD, '/')).not.toThrow()
  expect(signupAcquisition()).toEqual({ source: 'direct', version: 1 })
})
