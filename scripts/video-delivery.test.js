import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { createVideoDelivery } from '../api/_lib/video-delivery.js'
import { ApiError } from '../api/_lib/http-helpers.js'

const bytes = Buffer.alloc(6 * 1024 * 1024 + 17, 123)
let allowed, reads, checks, server, base
const deliver = createVideoDelivery({ file: () => ({
  getMetadata: async () => [{ size: String(bytes.length) }],
  createReadStream: ({ start, end }) => { reads++; return Readable.from((function* () { for (let i = start; i <= end; i += 65536) yield bytes.subarray(i, Math.min(end + 1, i + 65536)) })()) },
}) })
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res }
    try { await deliver(req, res, { path: 'dogs/author/puppy/videos/movie.mp4' }, async () => { checks++; if (!allowed) throw new ApiError(403, 'Access revoked') }) }
    catch (error) { res.statusCode = error.status || 500; res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/video`
})
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
beforeEach(() => { allowed = true; reads = 0; checks = 0 })
it('answers Safari HEAD without reading bytes or redirecting', async () => {
  const response = await fetch(base, { method: 'HEAD' })
  expect(response.status).toBe(200); expect(response.headers.get('content-length')).toBe(String(bytes.length))
  expect(response.headers.get('content-type')).toBe('video/mp4'); expect(response.headers.get('accept-ranges')).toBe('bytes')
  expect((await response.arrayBuffer()).byteLength).toBe(0); expect(reads).toBe(0); expect(checks).toBe(1)
})
it('answers the iPhone bytes=0-1 probe with exactly two bytes and no redirect', async () => {
  const response = await fetch(base, { headers: { Range: 'bytes=0-1' }, redirect: 'manual' })
  expect(response.status).toBe(206); expect(response.headers.get('location')).toBe(null)
  expect(response.headers.get('content-range')).toBe(`bytes 0-1/${bytes.length}`)
  expect((await response.arrayBuffer()).byteLength).toBe(2)
})
it('supports seeking with open and suffix ranges', async () => {
  for (const [range, count] of [[`bytes=${bytes.length - 100}-`, 100], ['bytes=-123', 123], [`bytes=${bytes.length - 10}-${bytes.length + 99}`, 10]]) {
    const response = await fetch(base, { headers: { Range: range } })
    expect(response.status).toBe(206); expect((await response.arrayBuffer()).byteLength).toBe(count)
  }
})
it('returns 416 for invalid/multiple ranges without opening a stream', async () => {
  for (const range of ['bytes=9-3', `bytes=${bytes.length}-`, 'bytes=0-1,3-4', 'bytes=-0', 'bytes=9007199254740992-']) {
    const response = await fetch(base, { headers: { Range: range } })
    expect(response.status).toBe(416); expect(response.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
  }
  expect(reads).toBe(0)
})
it('streams a whole movie above 4.5 MB without changing its bytes', async () => {
  const response = await fetch(base)
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store')
  const received = Buffer.from(await response.arrayBuffer())
  expect(createHash('sha256').update(received).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
})
it('rechecks permission for HEAD and every new range request', async () => {
  await (await fetch(base, { headers: { Range: 'bytes=0-1' } })).arrayBuffer()
  allowed = false
  expect((await fetch(base, { method: 'HEAD' })).status).toBe(403)
  expect((await fetch(base, { headers: { Range: 'bytes=2-3' } })).status).toBe(403)
  expect(reads).toBe(1); expect(checks).toBe(3)
})
