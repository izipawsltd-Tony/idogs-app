import { beforeEach, expect, it, vi } from 'vitest'
import { createQrDocumentsHandler, safeQrDocument } from '../api/_lib/qr-documents-handler.js'
vi.mock('../api/_lib/rate-limit.js', () => ({ checkRateLimit: () => ({ allowed: true }), hashClientKey: value => value, getClientIp: () => 'test' }))
const puppy = { id: 'ruby', tenantId: 'breeder', currentOwnerId: 'breeder', passportId: 'QR-RUBY', status: 'active' }
const document = { dogId: 'ruby', filePath: 'documents/breeder/ruby/health.pdf', name: 'Health report', privateEmail: 'private@example.invalid' }
let data, beforeBytes, deliveries, handler
const snap = path => ({ id: path.split('/').at(-1), exists: data.has(path), data: () => data.get(path) })
const ref = path => ({ path, get: async () => snap(path) })
beforeEach(() => {
  data = new Map([['dogs/ruby', { ...puppy }], ['documents/health', { ...document }]])
  deliveries = 0; beforeBytes = () => {}
  const db = {
    collection: collection => ({ doc: id => ref(`${collection}/${id}`), where: (key, op, value) => ({ limit: () => ({ get: async () => ({ empty: value !== 'QR-RUBY', docs: value === 'QR-RUBY' ? [snap('dogs/ruby')] : [] }) }) }) }),
    runTransaction: async callback => { const pending = []; const result = await callback({ get: async reference => snap(reference.path), set: (reference, value) => pending.push([reference.path, value]) }); for (const [path, value] of pending) data.set(path, value); return result },
  }
  handler = createQrDocumentsHandler({ db, timestamp: () => 'test-time', verifyToken: async token => { if (token === 'invalid') throw Error(); return { uid: token === 'other' ? 'other' : 'breeder', email_verified: token !== 'unverified' } }, serve: async (req, res, file, assertAccess) => { beforeBytes(); await assertAccess(); deliveries++; return res.status(200).json({ mime: file.mime }) } })
})
async function call(body, method = 'GET', token) {
  const res = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.code = code; return this }, json(value) { this.body = value; return this } }
  try { await handler({ body, query: body, method, headers: token ? { authorization: `Bearer ${token}` } : {} }, res) } catch (err) { res.code = err.status || 500; res.body = { error: err.message } }
  return res
}
const share = ids => call({ action: 'save', dogId: 'ruby', documentIds: ids }, 'POST', 'breeder')
it('keeps all files private until the verified current owner selects them', async () => {
  expect((await call({ passportId: 'QR-RUBY' })).body).toEqual({ documents: [] })
  expect((await call({ passportId: 'QR-RUBY', documentId: 'health' })).code).toBe(404)
  for (const token of [undefined, 'invalid', 'unverified', 'other']) expect((await call({ action: 'save', dogId: 'ruby', documentIds: ['health'] }, 'POST', token)).code).toBe(token === undefined || token === 'invalid' ? 401 : 403)
  expect(data.has('dogQrDocuments/ruby')).toBe(false)
})
it('shows the same selected files anonymously and after signup without exposing storage paths or contacts', async () => {
  expect((await share(['health'])).code).toBe(200)
  const anon = await call({ passportId: 'QR-RUBY' }), signed = await call({ passportId: 'QR-RUBY' }, 'GET', 'other')
  expect(signed.body).toEqual(anon.body)
  expect(anon.body.documents).toEqual([{ id: 'health', title: 'Health report', url: '/api/qr-documents?passportId=QR-RUBY&documentId=health' }])
  expect(JSON.stringify(anon.body)).not.toMatch(/breeder|filePath|privateEmail|private@example/)
  expect((await call({ passportId: 'QR-RUBY', documentId: 'health' }, 'HEAD')).code).toBe(200)
  expect(deliveries).toBe(1)
})
it('revokes both listing and direct file access using the old URL', async () => {
  await share(['health']); await share([])
  expect((await call({ passportId: 'QR-RUBY' })).body.documents).toEqual([])
  expect((await call({ passportId: 'QR-RUBY', documentId: 'health' })).code).toBe(404)
  expect(deliveries).toBe(0)
})
it('invalidates old grants on transfer and blocks the previous owner', async () => {
  await share(['health']); data.set('dogs/ruby', { ...puppy, currentOwnerId: 'new-owner' })
  expect((await call({ passportId: 'QR-RUBY' })).body.documents).toEqual([])
  expect((await share(['health'])).code).toBe(403)
  expect((await call({ passportId: 'QR-RUBY', documentId: 'health' })).code).toBe(404)
})
it.each([{ transferStatus: 'pendingClaim' }, { status: 'transferred' }])('stops public sharing while transfer is pending: %s', async change => {
  await share(['health']); data.set('dogs/ruby', { ...puppy, ...change })
  expect((await call({ passportId: 'QR-RUBY' })).body.documents).toEqual([])
})
it.each(['revoke', 'transfer', 'delete', 'replace'])('rechecks access before sending any bytes: %s', async change => {
  await share(['health'])
  beforeBytes = () => {
    if (change === 'revoke') data.set('dogQrDocuments/ruby', { ownerId: 'breeder', documentIds: [] })
    if (change === 'transfer') data.set('dogs/ruby', { ...puppy, currentOwnerId: 'next' })
    if (change === 'delete') data.delete('documents/health')
    if (change === 'replace') data.set('documents/health', { ...document, filePath: 'documents/breeder/ruby/replaced.pdf' })
  }
  expect((await call({ passportId: 'QR-RUBY', documentId: 'health' })).code).toBe(404); expect(deliveries).toBe(0)
})
it('rejects unrelated dog records, foreign files, traversal and active file formats', async () => {
  for (const overrides of [{ dogId: 'other' }, ...['documents/other/ruby/a.pdf', 'documents/breeder/other/a.pdf', 'documents/breeder/ruby/../a.pdf', 'documents/breeder/ruby/%2f.pdf', 'documents/breeder/ruby/a.svg', 'documents/breeder/ruby/a.html'].map(filePath => ({ filePath }))]) {
    data.set('documents/health', { ...document, ...overrides })
    expect(safeQrDocument(data.get('documents/health'), puppy)).toBeNull()
    expect((await share(['health'])).code).toBe(400)
    expect(data.has('dogQrDocuments/ruby')).toBe(false)
  }
})
it('never uses a legacy public URL or a client-side shared flag as a grant', async () => {
  data.set('documents/health', { dogId: 'ruby', public: true, fileUrl: 'https://attacker.invalid/a.pdf' })
  expect((await share(['health'])).code).toBe(400)
  expect((await call({ passportId: 'QR-RUBY' })).body.documents).toEqual([])
})
