import { describe, it, expect } from 'vitest'
import { createPuppyUpdatesHandler } from '../api/_lib/puppy-updates-handler.js'
import { canPublish, publicSharingLive, viewerRole, mayReadUpdate, safeUpdateMedia, validateUpdate } from '../api/_lib/puppy-updates-policy.js'

const breeder = { uid: 'breeder', email: 'breeder@example.test', email_verified: true }
const buyer = { uid: 'buyer', email: 'buyer@example.test', email_verified: true }
const stranger = { uid: 'stranger', email: 'stranger@example.test', email_verified: true }
const puppy = { tenantId: 'breeder', currentOwnerId: 'breeder', name: 'Ruby', breed: 'Poodle', passportId: 'DOG-RUBY', status: 'active', depositStatus: 'received', photos: [{ id: 'photo1', path: 'dogs/breeder/puppy1/photos/one.jpg' }], videos: [{ id: 'video1', path: 'dogs/breeder/puppy1/videos/one.mp4' }] }
const grant = { dogId: 'puppy1', grantedByUid: 'breeder', buyerEmail: buyer.email, status: 'active' }
const profile = { ownerId: 'breeder', publicEnabled: true }
const entry = (audience, more = {}) => ({ authorUid: 'breeder', sourceDogId: 'puppy1', audience, text: `${audience} update`, date: '2026-10-28', createdAt: '2026-10-28T10:00:00Z', media: [], ...more })

// Small Firestore-shaped store executes the actual endpoint's transactions,
// projections and authorization, rather than duplicating handler logic.
function store(seed) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]))
  const snapshot = path => ({ id: path.split('/').at(-1), exists: data.has(path), data: () => data.get(path), ref: doc(path) })
  function doc(path) { return { path, id: path.split('/').at(-1), parent: col(path.split('/').slice(0, -1).join('/')), collection: name => col(`${path}/${name}`), get: async () => snapshot(path), delete: async () => data.delete(path) } }
  function col(path, filters = [], max = Infinity, after = null) { return { path, doc: id => doc(`${path}/${id}`), where: (field, op, value) => col(path, [...filters, [field, value]], max), orderBy: () => col(path, filters, max, after), startAfter: snap => col(path, filters, max, snap.id), limit: n => col(path, filters, n, after), get: async () => { let keys = [...data.keys()].filter(key => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1 && filters.every(([field, value]) => data.get(key)[field] === value)); if (after) keys = keys.slice(keys.findIndex(k => k.split('/').at(-1) === after) + 1); const docs = keys.slice(0, max).map(snapshot); return { docs, empty: !docs.length, size: docs.length } } } }
  return { data, collection: col, runTransaction: async fn => { const pending = []; const result = await fn({ get: ref => ref.get(), create: (ref, value) => { if (data.has(ref.path)) throw Error('already exists'); pending.push([ref.path, value]) }, set: (ref, value, options) => pending.push([ref.path, options?.merge ? { ...data.get(ref.path), ...value } : value]), update: (ref, value) => pending.push([ref.path, { ...data.get(ref.path), ...value }]) }); pending.forEach(([k, v]) => data.set(k, v)); return result } }
}
function setup(extra = {}, onSign = () => {}) {
  const db = store({ 'dogs/puppy1': puppy, 'dogs/puppy2': { ...puppy, name: 'Blue', passportId: 'DOG-BLUE' }, 'puppyProfiles/puppy1': profile, 'dogPrivateAccess/puppy1': grant, ...extra })
  const signed = []
  const handler = createPuppyUpdatesHandler({ db, timestamp: () => '2026-10-28T10:00:00Z', verifyToken: async token => { const identity = { breeder, buyer, stranger, unverified: { ...buyer, email_verified: false } }[token]; if (!identity) throw Error('invalid'); return identity }, sign: async (items, ttl) => { signed.push(...items); onSign(db); return items.map(item => ({ id: item.id, url: `https://media.example.test/${item.id}?ttl=${ttl}` })) } })
  async function call(body, who, method = 'POST') {
    const response = { code: 200, headers: {}, status(code) { this.code = code; return this }, setHeader(k, v) { this.headers[k] = v }, json(value) { this.body = value; return this }, redirect(code, url) { this.code = code; this.url = url; return this } }
    try { await handler({ method, body, query: body, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), 'x-forwarded-for': '203.0.113.20' } }, response) } catch (e) { response.code = e.status || 500; response.body = { error: e.message } }
    return response
  }
  return { db, signed, call }
}
const create = (overrides = {}) => ({ action: 'create', dogIds: ['puppy1'], requestId: 'request-1', text: 'Week five in the garden', date: '2026-10-28', audience: 'buyer', mediaIds: ['photo1', 'video1'], ...overrides })

describe('Puppy update privacy through the ownership lifecycle', () => {
  it('distinguishes public, verified deposited buyer and owner', () => {
    const dog = { ...puppy, id: 'puppy1' }
    expect(viewerRole(dog, grant, breeder)).toBe('owner')
    expect(viewerRole(dog, grant, buyer)).toBe('buyer')
    expect(viewerRole(dog, grant, stranger)).toBe('public')
    expect(viewerRole(dog, grant, { ...buyer, email_verified: false })).toBe('public')
    expect(viewerRole({ ...dog, depositStatus: 'pending' }, grant, buyer)).toBe('public')
  })
  it('QR never authorizes private entries; sharing requires explicit current-owner opt-in', () => {
    expect(mayReadUpdate(entry('buyer'), puppy, profile, 'public')).toBe(false)
    expect(mayReadUpdate(entry('internal'), puppy, profile, 'buyer')).toBe(false)
    expect(mayReadUpdate(entry('public'), puppy, {}, 'public')).toBe(false)
    expect(mayReadUpdate(entry('public'), puppy, profile, 'public')).toBe(true)
  })
  it('preserves shared history for new owner, never internal notes; disables old public sharing', () => {
    const dog = { ...puppy, currentOwnerId: 'buyer' }
    expect(canPublish(dog, 'breeder')).toBe(false)
    expect(publicSharingLive(dog, profile)).toBe(false)
    expect(viewerRole({ ...dog, id: 'puppy1' }, grant, breeder)).toBe('public')
    expect(mayReadUpdate(entry('buyer'), dog, profile, 'owner')).toBe(true)
    expect(mayReadUpdate(entry('internal'), dog, profile, 'owner')).toBe(false)
    expect(mayReadUpdate(entry('public'), dog, { ownerId: 'buyer', publicEnabled: true }, 'public')).toBe(false)
  })
  it('freezes publishing while transfer awaits acceptance', () => {
    const dog = { ...puppy, status: 'transferred', transferStatus: 'pendingClaim' }
    expect(canPublish(dog, 'breeder')).toBe(false)
    expect(publicSharingLive(dog, profile)).toBe(false)
  })
  it('rejects foreign paths, traversal and forged media kinds', () => {
    const e = entry('buyer')
    expect(safeUpdateMedia({ id: 'one', kind: 'photo', path: 'dogs/breeder/puppy1/photos/a.jpg' }, e)).toBe(true)
    for (const path of ['dogs/stranger/puppy1/photos/a.jpg', 'dogs/breeder/puppy2/photos/a.jpg', 'dogs/breeder/puppy1/photos/../a.jpg', 'documents/breeder/puppy1/a.jpg']) expect(safeUpdateMedia({ id: 'one', kind: 'photo', path }, e)).toBe(false)
  })
  it('bounds batch, content, media and dates', () => {
    expect(validateUpdate(create()).dogIds).toEqual(['puppy1'])
    for (const changes of [{ dogIds: [] }, { dogIds: ['../x'] }, { dogIds: Array(13).fill('puppy1') }, { audience: 'all' }, { text: ' ' }, { text: 'x'.repeat(3001) }, { date: '2026-02-30' }, { mediaIds: ['x/y'] }, { requestId: '' }]) expect(() => validateUpdate(create(changes))).toThrow()
  })
})

describe('Actual puppy updates handler', () => {
  it('uses separate story media without growing the limited dog gallery', async () => {
    const saved = { ...puppy.photos[0], id: 'story-photo', authorUid: 'breeder', sourceDogId: 'puppy1', kind: 'photo', createdAt: '2026-10-28' }
    const { call, db } = setup({ 'puppyProfiles/puppy1/media/story-photo': saved })
    const result = await call(create({ mediaIds: ['story-photo'] }), 'breeder')
    expect(result.code).toBe(200)
    expect(db.data.get('dogs/puppy1').photos).toHaveLength(1)
    const gallery = await call({ action: 'gallery', dogId: 'puppy1' }, 'breeder')
    expect(gallery.code).toBe(200)
    expect(gallery.body.media.some(m => m.id === 'story-photo')).toBe(true)
    expect((await call({ action: 'gallery', dogId: 'puppy1' }, 'buyer')).code).toBe(403)
  })
  it('rejects a stale private response if ownership changes while media is being signed', async () => {
    const { call } = setup({ 'puppyProfiles/puppy1/updates/shared': entry('buyer', { media: [{ ...puppy.photos[0], kind: 'photo' }] }) }, db => db.data.set('dogs/puppy1', { ...puppy, currentOwnerId: 'buyer' }))
    const r = await call({ dogId: 'puppy1' }, 'breeder')
    expect(r.code).toBe(409)
    expect(r.body.updates).toBeUndefined()
  })
  it('pages lifetime history without silently losing older updates', async () => {
    const seed = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`puppyProfiles/puppy1/updates/page${String(i).padStart(2, '0')}`, entry('public')]))
    const { call } = setup(seed)
    const first = await call({ passportId: 'DOG-RUBY' })
    expect(first.body.updates).toHaveLength(25)
    expect(first.body.nextCursor).toBe('page24')
    const next = await call({ passportId: 'DOG-RUBY', cursor: first.body.nextCursor })
    expect(next.body.updates).toHaveLength(6)
    expect(next.body.nextCursor).toBe(null)
    expect(new Set([...first.body.updates, ...next.body.updates].map(u => u.id)).size).toBe(31)
    expect((await call({ passportId: 'DOG-RUBY', cursor: 'missing' })).code).toBe(400)
  })
  it('uploads no bytes and publishes one shared media reference for multiple owned puppies', async () => {
    const { call, db } = setup()
    const r = await call(create({ dogIds: ['puppy1', 'puppy2'] }), 'breeder')
    expect(r.code).toBe(200)
    const a = db.data.get(`puppyProfiles/puppy1/updates/${r.body.updateId}`)
    const b = db.data.get(`puppyProfiles/puppy2/updates/${r.body.updateId}`)
    expect(a.media).toEqual(b.media)
    expect(a.media[0].path).toBe('dogs/breeder/puppy1/photos/one.jpg')
  })
  it('rejects a mixed-owner batch atomically', async () => {
    const { call, db } = setup({ 'dogs/puppy2': { ...puppy, currentOwnerId: 'stranger' } })
    expect((await call(create({ dogIds: ['puppy1', 'puppy2'] }), 'breeder')).code).toBe(403)
    expect([...db.data.keys()].filter(k => k.includes('/updates/'))).toHaveLength(0)
  })
  it('retries do not duplicate an update', async () => {
    const { call, db } = setup()
    const a = await call(create(), 'breeder'); const b = await call(create(), 'breeder')
    expect(b.body.updateId).toBe(a.body.updateId); expect(b.body.repeated).toBe(true)
    expect([...db.data.keys()].filter(k => k.includes('/updates/'))).toHaveLength(1)
  })
  it('never signs forged media or publishes stale selections', async () => {
    const { call, signed } = setup()
    expect((await call(create({ mediaIds: ['foreign'] }), 'breeder')).code).toBe(400)
    expect(signed).toHaveLength(0)
  })
  it('only returns explicitly shared entries and no owner/buyer PII', async () => {
    const { call } = setup({ 'puppyProfiles/puppy1/updates/internal': entry('internal'), 'puppyProfiles/puppy1/updates/public': entry('public'), 'puppyProfiles/puppy1/updates/buyer': entry('buyer') })
    const publicView = await call({ passportId: 'DOG-RUBY' })
    expect(publicView.body.updates.map(u => u.id)).toEqual(['public'])
    expect(publicView.body.dogId).toBeUndefined()
    expect(JSON.stringify(publicView.body)).not.toContain('breeder@example')
    const buyerView = await call({ dogId: 'puppy1' }, 'buyer')
    expect(buyerView.body.role).toBe('buyer')
    expect(buyerView.body.updates.map(u => u.id)).toEqual(['public', 'buyer'])
  })
  it('revocation and refund remove private updates on the next request', async () => {
    const { call, db } = setup({ 'puppyProfiles/puppy1/updates/buyer': entry('buyer') })
    expect((await call({ dogId: 'puppy1' }, 'buyer')).body.updates).toHaveLength(1)
    db.data.set('dogPrivateAccess/puppy1', { ...grant, status: 'revoked' })
    expect((await call({ dogId: 'puppy1' }, 'buyer')).body.updates).toHaveLength(0)
    db.data.set('dogPrivateAccess/puppy1', grant); db.data.set('dogs/puppy1', { ...puppy, depositStatus: 'refunded' })
    expect((await call({ dogId: 'puppy1' }, 'buyer')).body.role).toBe('public')
  })
  it('public media endpoint rechecks sharing, deletion and audience each time', async () => {
    const media = [{ ...puppy.photos[0], kind: 'photo' }]
    const { call, db } = setup({ 'puppyProfiles/puppy1/updates/public': entry('public', { media }) })
    const request = { action: 'media', passportId: 'DOG-RUBY', updateId: 'public', mediaId: 'photo1' }
    expect((await call(request, null, 'GET')).code).toBe(302)
    db.data.set('puppyProfiles/puppy1', { ...profile, publicEnabled: false })
    expect((await call(request, null, 'GET')).code).toBe(404)
    db.data.set('puppyProfiles/puppy1', profile); db.data.set('puppyProfiles/puppy1/updates/public', entry('buyer', { media }))
    expect((await call(request, null, 'GET')).code).toBe(404)
    db.data.set('puppyProfiles/puppy1/updates/public', entry('public', { media, deleted: true }))
    expect((await call(request, null, 'GET')).code).toBe(404)
  })
  it('keeps the QR through ownership transfer and removes breeder edit access', async () => {
    const { call, db } = setup({ 'puppyProfiles/puppy1/updates/shared': entry('buyer'), 'puppyProfiles/puppy1/updates/internal': entry('internal') })
    db.data.set('dogs/puppy1', { ...puppy, currentOwnerId: 'buyer' })
    const r = await call({ passportId: 'DOG-RUBY' }, 'buyer')
    expect(r.body.role).toBe('owner'); expect(r.body.dog.passportId).toBe('DOG-RUBY')
    expect(r.body.updates.map(u => u.id)).toEqual(['shared'])
    expect((await call(create(), 'breeder')).code).toBe(403)
    expect((await call({ action: 'settings', dogId: 'puppy1', publicEnabled: true }, 'breeder')).code).toBe(403)
    expect((await call({ passportId: 'DOG-RUBY' })).body.updates).toHaveLength(0)
  })
  it('new owner can remove inherited history but cannot expose former private notes', async () => {
    const { call } = setup({ 'dogs/puppy1': { ...puppy, currentOwnerId: 'buyer' }, 'puppyProfiles/puppy1/updates/internal': entry('internal'), 'puppyProfiles/puppy1/updates/shared': entry('buyer') })
    expect((await call({ action: 'visibility', dogId: 'puppy1', updateId: 'internal', audience: 'public' }, 'buyer')).code).toBe(403)
    expect((await call({ action: 'delete', dogId: 'puppy1', updateId: 'internal' }, 'buyer')).code).toBe(403)
    expect((await call({ action: 'delete', dogId: 'puppy1', updateId: 'shared' }, 'buyer')).code).toBe(200)
  })
  it('follows are scoped to account and grant no private access', async () => {
    const { call } = setup({ 'puppyProfiles/puppy1/updates/buyer': entry('buyer') })
    expect((await call({ action: 'follow', passportId: 'DOG-RUBY' }, 'stranger')).code).toBe(200)
    expect((await call({ action: 'list' }, 'stranger')).body.puppies).toHaveLength(1)
    expect((await call({ action: 'list' }, 'buyer')).body.puppies).toHaveLength(0)
    expect((await call({ passportId: 'DOG-RUBY' }, 'stranger')).body.updates).toHaveLength(0)
    expect((await call({ action: 'unfollow', passportId: 'DOG-RUBY' }, 'stranger')).code).toBe(200)
    expect((await call({ action: 'list' }, 'stranger')).body.puppies).toHaveLength(0)
  })
  it('requires authentication and verified email for following', async () => {
    const { call } = setup()
    expect((await call({ action: 'follow', dogId: 'puppy1' })).code).toBe(401)
    expect((await call({ action: 'follow', dogId: 'puppy1' }, 'unverified')).code).toBe(403)
    expect((await call({ action: 'create' }, 'broken')).code).toBe(401)
    expect((await call({ action: 'settings', dogId: 'puppy1', publicEnabled: true }, 'stranger')).code).toBe(403)
  })
})
