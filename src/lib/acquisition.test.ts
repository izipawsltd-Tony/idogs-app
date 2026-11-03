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
it('clearAcquisition removes the stored first touch after signup', async () => {
  const { clearAcquisition } = await import('./acquisition')
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  captureAcquisition('?utm_source=facebook', '/')
  clearAcquisition()
  expect(signupAcquisition()).toEqual({ source: 'direct', version: 1 })
})

it('carries the first touch through the email sign-in link, for completion in another browser', async () => {
  const { acquisitionReturnParam, acquisitionFromReturnParam } = await import('./acquisition')
  captureAcquisition(AD, '/')
  const param = acquisitionReturnParam()!
  expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(atob(param.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('SECRETCLICKID')
  store.clear()                                                    // the mail app's browser has nothing stored
  expect(acquisitionFromReturnParam(param)).toMatchObject({ source: 'facebook', campaign: 'Puppy Owners Nov', adId: '3', fbclid: true, landingPath: '/' })
  captureAcquisition('?next=%2Fapp&flow=abc&acq=' + param, '/auth/finish')
  expect(signupAcquisition()).toMatchObject({ source: 'facebook', campaign: 'Puppy Owners Nov' })
})
it('rejects tampered, stale or oversized return params and keeps only known cleaned fields', async () => {
  const { acquisitionFromReturnParam } = await import('./acquisition')
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = new Date().toISOString()
  expect(acquisitionFromReturnParam('not base64!')).toBeNull()
  expect(acquisitionFromReturnParam('A'.repeat(2000))).toBeNull()
  expect(acquisitionFromReturnParam(enc({ version: 2, source: 'x', firstSeenAt: now }))).toBeNull()
  expect(acquisitionFromReturnParam(enc({ version: 1, source: 'x', firstSeenAt: '2020-01-01T00:00:00Z' }))).toBeNull()
  const a = acquisitionFromReturnParam(enc({ version: 1, source: '<b>fb</b>', email: 'a@b.c', fbclid: 'RAW', landingPath: '/evil', firstSeenAt: now }))!
  expect(a).toMatchObject({ source: 'bfb/b', fbclid: false, landingPath: 'other' })
  expect(JSON.stringify(a)).not.toContain('a@b.c')
})
it('the email return URL carries campaign labels only', async () => {
  const { emailReturnUrl } = await import('./passwordless')
  const u = new URL(emailReturnUrl('https://idogs.com.au', '/app/dashboard', 'f'.repeat(20), 'eyJ4IjoxfQ'))
  expect(u.searchParams.get('acq')).toBe('eyJ4IjoxfQ')
  expect(new URL(emailReturnUrl('https://idogs.com.au', '/app/dashboard', 'f'.repeat(20))).searchParams.has('acq')).toBe(false)
})
