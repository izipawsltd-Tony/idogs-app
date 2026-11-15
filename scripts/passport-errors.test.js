import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: () => ({ where: () => ({ limit: () => ({ get: s.get }) }) }) }) }))
vi.mock('../api/_lib/rate-limit.js', () => ({ checkRateLimit: () => ({ allowed: true }), getClientIp: () => 'test', hashClientKey: value => value }))
import handler from '../api/passport.js'
beforeEach(() => s.get.mockReset())
afterEach(() => vi.restoreAllMocks())
async function call(passportId) { const res = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.code = code; return this }, json(value) { this.body = value; return this } }; await handler({ method: 'GET', query: { passportId }, headers: {} }, res); return res }
it('does not expose raw Firestore errors or project details to anonymous viewers or logs', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  s.get.mockRejectedValue(new Error('PRIVATE_DETAIL project/secret-account internal@example.invalid'))
  const res = await call('QR-RUBY')
  expect(res.code).toBe(500)
  expect(res.body).toEqual({ error: 'Could not load this profile. Please try again.' })
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_DETAIL')
  expect(res.headers['Cache-Control']).toContain('no-store')
})
it.each([undefined, [], ['one', 'two'], 'x'.repeat(129)])('rejects malformed lookup arguments without hitting Firestore: %s', async value => {
  expect((await call(value)).code).toBe(400); expect(s.get).not.toHaveBeenCalled()
})
