import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ snapshot: null, files: [], signed: [], generation: '1234', bucket: 'test-bucket' }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async token => { if (token === 'bad') throw Error(); return { uid: token } } }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: name => {
  if (name !== 'ownershipHistorySnapshots') throw Error('Live read')
  return { doc: () => ({ get: async () => ({ exists: !!state.snapshot, data: () => state.snapshot }) }) }
} }) }))
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: (path, options) => {
  state.files.push({ path, options })
  return { getMetadata: async () => [{ generation: state.generation }], getSignedUrl: async input => { state.signed.push(input); return ['https://example.test/historical-image'] } }
} }) }) }))
vi.mock('../api/_lib/require-config.js', () => ({ requireStorageBucket: () => state.bucket }))
import handler from '../api/get-history-media.js'
const request = async (uid = 'former', body = { snapshotId: 'snap', dogId: 'dog' }, method = 'POST') => {
  const res = { code: 200, setHeader: vi.fn(), status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  await handler({ method, headers: { authorization: uid ? `Bearer ${uid}` : '' }, body }, res); return res
}
beforeEach(() => { state.snapshot = { fromOwnerId: 'former', dogId: 'dog', recoveredMedia: [{ path: 'dogs/former/dog/photos/old.jpg', generation: '1234' }] }; state.files = []; state.signed = []; state.generation = '1234'; state.bucket = 'test-bucket' })
test('requires verified identity and POST', async () => {
  expect((await request('')).code).toBe(401); expect((await request('bad')).code).toBe(401)
  expect((await request('former', {}, 'GET')).code).toBe(405); expect(state.files).toHaveLength(0)
})
test('stranger and wrong dog cannot trigger storage reads', async () => {
  expect((await request('stranger')).code).toBe(404); expect((await request('former', { snapshotId: 'snap', dogId: 'other' })).code).toBe(404); expect(state.files).toHaveLength(0)
})
test('signs exact snapshot generation, ignores caller paths, disables caching', async () => {
  const r = await request('former', { snapshotId: 'snap', dogId: 'dog', path: 'dogs/buyer/dog/private.jpg' })
  expect(r.code).toBe(200); expect(r.body.photos).toHaveLength(1)
  expect(state.files[0].options.generation).toBe('1234'); expect(state.signed[0].queryParams.generation).toBe('1234')
  expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
})
test('an overwritten generation cannot return current image bytes', async () => {
  state.generation = '9999'; const r = await request(); expect(r.body.photos).toHaveLength(0); expect(r.body.unavailable).toBe(1); expect(state.signed).toHaveLength(0)
})
test('rejects foreign namespace, traversal and invalid generation', async () => {
  state.snapshot.recoveredMedia = [{ path: 'dogs/buyer/dog/photos/new.jpg', generation: '1234' }, { path: 'dogs/former/dog/../other.jpg', generation: '1234' }, { path: 'dogs/former/dog/photos/x.jpg', generation: 'bad' }]
  const r = await request(); expect(r.body.photos).toHaveLength(0); expect(state.files).toHaveLength(0)
})
test('missing config, nonexistent snapshot and invalid input fail closed', async () => {
  state.bucket = null; expect((await request()).code).toBe(500); expect(state.files).toHaveLength(0)
  state.bucket = 'test-bucket'; state.snapshot = null; expect((await request()).code).toBe(404)
  expect((await request('former', { snapshotId: '../private', dogId: 'dog' })).code).toBe(400)
})
