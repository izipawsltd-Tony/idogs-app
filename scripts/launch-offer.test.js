import { describe, expect, it, vi } from 'vitest'
import { LAUNCH_OFFER, FOUNDING_OFFER, daysLeft } from '../shared/access-grants.js'
import { createLaunchClaimHandler, createOfferStatusHandler, launchOfferState } from '../api/_lib/launch-offer-handler.js'

const NOW = Date.parse('2026-11-20T00:00:00Z')

function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial))
  const db = {
    store,
    collection: col => ({ doc: id => ({ id, path: `${col}/${id}` }) }),
    runTransaction: async fn => {
      const writes = []
      const out = await fn({ get: async r => ({ exists: store.has(r.path), data: () => store.get(r.path) }), set: (r, d, o) => writes.push([r, d, o]) })
      for (const [r, d, o] of writes) store.set(r.path, o?.merge ? { ...(store.get(r.path) || {}), ...d } : d)
      return out
    },
  }
  return db
}
function mockRes() {
  const r = { statusCode: 0, body: undefined, headers: {} }
  r.status = c => { r.statusCode = c; return r }
  r.json = b => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}
const post = { method: 'POST', headers: { authorization: 'Bearer t' } }
const counterPath = `accessGrantCounters/${LAUNCH_OFFER.id}`

describe('launch status', () => {
  it('reports the real remaining count and closes at 100 or 31 Dec', () => {
    expect(launchOfferState({ claimed: 3, nowMs: NOW })).toMatchObject({ active: true, remaining: 97 })
    expect(launchOfferState({ claimed: 100, nowMs: NOW }).active).toBe(false)
    expect(launchOfferState({ claimed: 0, nowMs: LAUNCH_OFFER.claimEnd }).active).toBe(false)
    expect(daysLeft(LAUNCH_OFFER.claimEnd, NOW)).toBe(42)
  })
  it('shows the number only at or below 50, and offers the pass only when free places are gone', async () => {
    const run = async claimed => { const res = mockRes(); await createOfferStatusHandler({ getLaunchClaimed: async () => claimed, launchEnabled: () => true, passEnabled: () => true, now: () => NOW })({ method: 'GET' }, res); return res.body }
    expect(await run(10)).toMatchObject({ launch: { active: true, showRemaining: false }, pass: { active: false } })
    expect(await run(60)).toMatchObject({ launch: { active: true, remaining: 40, showRemaining: true }, pass: { active: false } })
    expect(await run(100)).toMatchObject({ launch: { active: false }, pass: { active: true } })
  })
  it('is off by default', async () => {
    const res = mockRes()
    await createOfferStatusHandler({ getLaunchClaimed: async () => 0, now: () => NOW })({ method: 'GET' }, res)
    expect(res.body.launch.active).toBe(false)
    expect(res.body.pass.active).toBe(false)
    expect(FOUNDING_OFFER.terms).not.toMatch(/Founding|first 20/)
  })
})

describe('launch claim', () => {
  const handler = (db, over = {}) => createLaunchClaimHandler({
    verifyIdToken: async () => ({ uid: 'u1', email_verified: true }), db, isEnabled: () => true,
    countOwnedActiveDogs: async () => 1, now: () => NOW, ...over,
  })

  it('needs a dog first, then grants 12 months once and counts it', async () => {
    const db = fakeDb({ 'users/u1': { plan: 'free' } })
    let res = mockRes(); await handler(db, { countOwnedActiveDogs: async () => 0 })(post, res)
    expect(res.body.code).toBe('LAUNCH_NEEDS_DOG')
    expect(db.store.get(counterPath)).toBeUndefined()
    res = mockRes(); await handler(db)(post, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ grantedUntil: '2027-11-20T00:00:00.000Z', remaining: 99 })
    expect(db.store.get('users/u1').accessGrant).toMatchObject({ kind: 'launch', offerId: LAUNCH_OFFER.id })
    res = mockRes(); await handler(db)(post, res)
    expect(res.body.code).toBe('LAUNCH_ALREADY_CLAIMED')
    expect(db.store.get(counterPath).count).toBe(1)
  })
  it('refuses when sold out, closed, disabled, unverified or already holding a pass', async () => {
    const base = { 'users/u1': {} }
    let res = mockRes(); await handler(fakeDb({ ...base, [counterPath]: { count: 100 } }))(post, res)
    expect(res.body.code).toBe('LAUNCH_SOLD_OUT')
    res = mockRes(); await handler(fakeDb(base), { now: () => LAUNCH_OFFER.claimEnd })(post, res)
    expect(res.body.code).toBe('LAUNCH_CLOSED')
    res = mockRes(); await handler(fakeDb(base), { isEnabled: undefined })(post, res)
    expect(res.statusCode).toBe(503)
    res = mockRes(); await handler(fakeDb(base), { verifyIdToken: async () => ({ uid: 'u1' }) })(post, res)
    expect(res.statusCode).toBe(403)
    res = mockRes(); await handler(fakeDb({ 'users/u1': { accessGrant: { granted: true, kind: 'gift', expiresAt: '2027-11-01T00:00:00Z' } } }))(post, res)
    expect(res.body.code).toBe('LAUNCH_HAS_PASS')
  })
})
