import { describe, expect, it, vi } from 'vitest'
import { beaconFields, landingBeaconHandler, lcpBucket } from '../api/_lib/landing-beacon.js'

function run(body, method = 'POST') {
  const writes = []
  const db = { collection: () => ({ doc: id => ({ set: async (data, opt) => writes.push({ id, data, opt }) }) }) }
  const res = { setHeader: vi.fn(), status(c) { this.code = c; return this }, end() { return this } }
  return landingBeaconHandler({ db, increment: n => ({ inc: n }), now: () => new Date('2026-11-02T10:00:00Z') })({ method, body }, res).then(() => ({ res, writes }))
}
describe('anonymous landing beacon', () => {
  it('buckets LCP', () => {
    expect([lcpBucket(800), lcpBucket(1800), lcpBucket(3000), lcpBucket(9000), lcpBucket(undefined)]).toEqual(['lt1s', '1-2.5s', '2.5-4s', 'gt4s', 'na'])
  })
  it('stores only aggregate counters per day — no identifiers, nested merge', async () => {
    const { res, writes } = await run({ path: '/', lcp: 1700, fbclid: true, campaignId: '120200000001', adId: '3', email: 'x@y.z', ua: 'secret' })
    expect(res.code).toBe(204)
    expect(writes[0].id).toBe('2026-11-02'); expect(writes[0].opt).toEqual({ merge: true })
    const json = JSON.stringify(writes[0].data)
    expect(json).not.toContain('x@y.z'); expect(json).not.toContain('secret')
    expect(writes[0].data.byCampaign['120200000001']).toEqual({ loads: { inc: 1 }, 'lcp_1-2.5s': { inc: 1 } })
    expect(writes[0].data.bySource.meta_click).toEqual({ inc: 1 })
  })
  it('ignores private paths, junk and non-POST without writing', async () => {
    expect((await run({ path: '/app/dogs' })).writes).toHaveLength(0)
    expect((await run('not json')).writes).toHaveLength(0)
    expect((await run({ path: '/' }, 'GET')).res.code).toBe(405)
  })
  it('sanitises keys so a caller cannot write arbitrary field paths', () => {
    expect(beaconFields({ path: '/', campaignId: 'a.b.c', adId: '$$<script>' })).toMatchObject({ campaign: 'a_b_c', ad: 'none' })
  })
})
