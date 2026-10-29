import { describe, it, expect } from 'vitest'
import { createPuppyUpdatesHandler } from '../api/_lib/puppy-updates-handler.js'
import { canPublish, publicSharingLive, publicMediaBase, viewerRole, mayReadUpdate, safeUpdateMedia, validateUpdate } from '../api/_lib/puppy-updates-policy.js'

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
function setup(extra = {}, onSign = () => {}, serveVideo) {
  const db = store({ 'dogs/puppy1': puppy, 'dogs/puppy2': { ...puppy, name: 'Blue', passportId: 'DOG-BLUE' }, 'puppyProfiles/puppy1': profile, 'dogPrivateAccess/puppy1': grant, ...extra })
  const signed = []
  const handler = createPuppyUpdatesHandler({ db, serveVideo, timestamp: () => '2026-10-28T10:00:00Z', verifyToken: async token => { const identity = { breeder, buyer, stranger, unverified: { ...buyer, email_verified: false } }[token]; if (!identity) throw Error('invalid'); return identity }, sign: async (items, ttl) => { signed.push(...items); onSign(db); return items.map(item => ({ id: item.id, url: `https://media.example.test/${item.id}?ttl=${ttl}` })) } })
  async function call(body, who, method = 'POST') {
    const response = { code: 200, headers: {}, status(code) { this.code = code; return this }, setHeader(k, v) { this.headers[k] = v }, json(value) { this.body = value; return this }, redirect(code, url) { this.code = code; this.url = url; return this } }
    try { await handler({ method, body, query: body, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), 'x-forwarded-for': '203.0.113.20' } }, response) } catch (e) { response.code = e.status || 500; response.body = { error: e.message } }
    return response
  }
  return { db, signed, call }
}
const create = (overrides = {}) => ({ action: 'create', dogIds: ['puppy1'], requestId: 'request-1', text: 'Week five in the garden', date: '2026-10-28', audience: 'buyer', mediaIds: ['photo1', 'video1'], ...overrides })

describe('Puppy update privacy through the ownership lifecycle', () => {
  it('uses the public customer domain instead of SSO-protected immutable Production URLs', () => {
    expect(publicMediaBase({ FIREBASE_PROJECT_ID: 'idogs-app', VERCEL_URL: 'protected.vercel.app' })).toBe('https://idogs.com.au')
    expect(publicMediaBase({ FIREBASE_PROJECT_ID: 'idogs-app-staging', VERCEL_URL: 'qa.vercel.app' })).toBe('https://qa.vercel.app')
    expect(publicMediaBase({ FIREBASE_PROJECT_ID: 'idogs-app-staging', IDOGS_NATIVE_QA_BACKEND: '1', VERCEL_URL: 'temporary.vercel.app' })).toBe('https://idogs-puppy-journey-qa-izipawsltd-tonys-projects.vercel.app')
    expect(publicMediaBase({ VERCEL_URL: 'evil.example/path' })).toBe('')
    expect(publicMediaBase({})).toBe('')
  })
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
    for (const changes of [{ dogIds: [] }, { dogIds: ['../x'] }, { dogIds: Array(13).fill('puppy1') }, { audience: 'all' }, { text: ' ', mediaIds: [] }, { text: 'x'.repeat(3001) }, { date: '2026-02-30' }, { mediaIds: ['x/y'] }, { requestId: '' }]) expect(() => validateUpdate(create(changes))).toThrow()
  })
})

describe('Actual puppy updates handler', () => {
  it('publishes media without a caption but rejects a completely empty update', async () => {
    const { call } = setup()
    expect((await call(create({ text: '', audience: 'public', mediaIds: ['photo1'] }), 'breeder')).code).toBe(200)
    expect((await call({ passportId: 'DOG-RUBY' })).body.updates[0].text).toBe('')
    expect((await call(create({ requestId: 'empty', text: ' ', mediaIds: [] }), 'breeder')).code).toBe(400)
  })
  it('authorizes HEAD and range video delivery and rejects a changed update before bytes leave', async () => {
    const media = [{ ...puppy.videos[0], kind: 'video' }]
    let deliveries = 0, removeBeforeRead = false
    const { call, db, signed } = setup({ 'puppyProfiles/puppy1/updates/movie': entry('public', { media }) }, () => {}, async (req, res, item, assertAccess) => {
      if (removeBeforeRead) db.data.set('puppyProfiles/puppy1/updates/movie', entry('public', { media, deleted: true }))
      await assertAccess(); deliveries++
      return res.status(200).json({ delivered: item.id, method: req.method })
    })
    const request = { action: 'media', passportId: 'DOG-RUBY', updateId: 'movie', mediaId: 'video1' }
    expect((await call(request, null, 'HEAD')).code).toBe(200)
    expect((await call(request, null, 'GET')).code).toBe(200)
    expect(signed).toHaveLength(0)
    removeBeforeRead = true
    expect((await call(request, null, 'GET')).code).toBe(404)
    expect(deliveries).toBe(2)
    expect((await call({ passportId: 'DOG-RUBY' }, null, 'HEAD')).code).toBe(405)
  })
  it('signs repeated visible files once for the whole page and excludes private hidden files', async () => {
    let signingCalls = 0
    const shared = { ...puppy.photos[0], kind: 'photo' }
    const { call, signed } = setup({
      'puppyProfiles/puppy1/updates/first': entry('buyer', { media: [shared] }),
      'puppyProfiles/puppy1/updates/second': entry('buyer', { media: [{ ...shared, id: 'alias-photo' }] }),
      'puppyProfiles/puppy1/updates/hidden': entry('internal', { media: [{ ...shared, id: 'hidden', path: 'dogs/breeder/puppy1/photos/secret.jpg' }] }),
    }, () => { signingCalls++ })
    const result = await call({ dogId: 'puppy1' }, 'buyer')
    expect(result.code).toBe(200); expect(signingCalls).toBe(1); expect(signed).toHaveLength(1)
    expect(result.body.updates.map(u => u.media[0].id)).toEqual(['photo1', 'alias-photo'])
    expect(result.body.updates[0].media[0].url).toBe(result.body.updates[1].media[0].url)
  })
  it('edits text/date/audience, replaces media and leaves other puppy copies unchanged', async () => {
    const { call, db } = setup()
    const created = await call(create({ dogIds: ['puppy1', 'puppy2'] }), 'breeder')
    const id = created.body.updateId
    const other = structuredClone(db.data.get(`puppyProfiles/puppy2/updates/${id}`))
    const edited = await call({ action: 'edit', dogId: 'puppy1', updateId: id, text: 'A new adventure', date: '2026-10-27', audience: 'internal', mediaIds: ['photo1'] }, 'breeder')
    expect(edited.code).toBe(200)
    const update = db.data.get(`puppyProfiles/puppy1/updates/${id}`)
    expect(update.text).toBe('A new adventure'); expect(update.date).toBe('2026-10-27'); expect(update.audience).toBe('internal')
    expect(update.media.map(m => m.id)).toEqual(['photo1'])
    expect(db.data.get(`puppyProfiles/puppy2/updates/${id}`)).toEqual(other)
    expect((await call({ passportId: 'DOG-RUBY' })).body.updates).toHaveLength(0)
    expect(db.data.get('dogs/puppy1').photos).toHaveLength(1)
  })
  it('allows replacing group-copy media with current puppy media and still serves retained group media', async () => {
    const { call, db } = setup({ 'puppyProfiles/puppy2': profile, 'dogs/puppy2': { ...puppy, passportId: 'DOG-BLUE', photos: [{ id: 'blue-photo', path: 'dogs/breeder/puppy2/photos/blue.jpg' }] } })
    const created = await call(create({ dogIds: ['puppy1', 'puppy2'] }), 'breeder')
    const id = created.body.updateId
    expect((await call({ action: 'edit', dogId: 'puppy2', updateId: id, text: 'Blue with Ruby', date: '2026-10-28', audience: 'public', mediaIds: ['photo1', 'blue-photo'] }, 'breeder')).code).toBe(200)
    const edited = db.data.get(`puppyProfiles/puppy2/updates/${id}`)
    expect(edited.media.every(m => safeUpdateMedia(m, edited))).toBe(true)
    expect((await call({ action: 'media', passportId: 'DOG-BLUE', updateId: id, mediaId: 'blue-photo' }, null, 'GET')).code).toBe(302)
  })
  it('rejects edit by buyer, stranger, former owner or new owner of inherited entries', async () => {
    const { call, db } = setup({ 'puppyProfiles/puppy1/updates/editable': entry('buyer') })
    const request = { action: 'edit', dogId: 'puppy1', updateId: 'editable', text: 'Changed', date: '2026-10-28', audience: 'public', mediaIds: [] }
    for (const who of ['buyer', 'stranger']) expect((await call(request, who)).code).toBe(403)
    db.data.set('dogs/puppy1', { ...puppy, currentOwnerId: 'buyer' })
    for (const who of ['breeder', 'buyer']) expect((await call(request, who)).code).toBe(403)
  })
  it('rejects unavailable media and deleted edits without changing the saved update', async () => {
    const { call, db } = setup({ 'puppyProfiles/puppy1/updates/editable': entry('buyer') })
    const request = { action: 'edit', dogId: 'puppy1', updateId: 'editable', text: 'Changed', date: '2026-10-28', audience: 'public', mediaIds: ['foreign'] }
    expect((await call(request, 'breeder')).code).toBe(400)
    expect(db.data.get('puppyProfiles/puppy1/updates/editable').text).toBe('buyer update')
    db.data.set('puppyProfiles/puppy1/updates/editable', entry('buyer', { deleted: true }))
    expect((await call({ ...request, mediaIds: [] }, 'breeder')).code).toBe(403)
  })
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
  it('allows authenticated unverified users to follow without unlocking private data', async () => {
    const { call } = setup()
    expect((await call({ action: 'follow', dogId: 'puppy1' })).code).toBe(401)
    expect((await call({ action: 'follow', dogId: 'puppy1' }, 'unverified')).code).toBe(200)
    const story = await call({ passportId: 'DOG-RUBY' }, 'unverified')
    expect(story.body.role).toBe('public')
    expect(story.body.updates.some(u => u.audience !== 'public')).toBe(false)
    expect((await call({ action: 'create', dogId: 'puppy1' }, 'unverified')).code).toBe(403)
    expect((await call({ action: 'create' }, 'broken')).code).toBe(401)
    expect((await call({ action: 'settings', dogId: 'puppy1', publicEnabled: true }, 'stranger')).code).toBe(403)
  })
})
