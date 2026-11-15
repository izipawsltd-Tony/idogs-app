import { beforeAll, afterAll, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createDocumentDelivery } from '../api/_lib/document-delivery.js'
import { ApiError } from '../api/_lib/http-helpers.js'
const bytes = Buffer.from('%PDF-1.7\nSynthetic QA document\n%%EOF')
let server, base, reads = 0, allowed = true
beforeAll(async () => {
  const deliver = createDocumentDelivery({ file: () => ({ getMetadata: async () => [{ size: String(bytes.length) }], createReadStream: ({ start, end }) => { reads++; return Readable.from([bytes.subarray(start, end + 1)]) } }) })
  server = createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res }
    try { await deliver(req, res, { path: 'documents/qa/ruby/health.pdf', mime: 'application/pdf' }, async () => { if (!allowed) throw new ApiError(404, 'Not shared') }) }
    catch (error) { res.statusCode = error.status || 500; res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}/document`
})
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
it('serves PDF HEAD, range and full bytes without redirecting to a reusable signed URL', async () => {
  const head = await fetch(base, { method: 'HEAD' })
  expect(head.status).toBe(200); expect(head.headers.get('content-type')).toBe('application/pdf'); expect(reads).toBe(0)
  const range = await fetch(base, { headers: { Range: 'bytes=0-4' }, redirect: 'manual' })
  expect(range.status).toBe(206); expect(await range.text()).toBe('%PDF-'); expect(range.headers.get('location')).toBeNull()
  const full = await fetch(base)
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes)
  expect(full.headers.get('cache-control')).toContain('no-store'); expect(full.headers.get('x-content-type-options')).toBe('nosniff')
})
it('returns 416 for an invalid range and rechecks revocation on subsequent opens', async () => {
  const before = reads
  expect((await fetch(base, { headers: { Range: 'bytes=9-2' } })).status).toBe(416)
  expect(reads).toBe(before)
  allowed = false
  expect((await fetch(base)).status).toBe(404); expect((await fetch(base, { method: 'HEAD' })).status).toBe(404)
  expect(reads).toBe(before)
})
