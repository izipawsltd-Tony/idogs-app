import { beforeEach, describe, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({
  user: { uid: 'former', getIdToken: vi.fn(async () => 'test-token') },
  getDoc: vi.fn(), getDocs: vi.fn(),
}))
vi.mock('./firebase', () => ({ auth: { currentUser: f.user }, db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  where: (key: string, op: string, value: unknown) => ({ key, op, value }),
  query: (name: string, ...filters: unknown[]) => ({ name, filters }),
  getDoc: f.getDoc, getDocs: f.getDocs,
  addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(), setDoc: vi.fn(), Timestamp: class {}, deleteField: vi.fn(),
}))
import { getDog, getDogs, getAllRemindersForUser, getAllPendingReminders, GetRemindersError } from './db'

const record = (id: string, data: Record<string, unknown>) => ({ id, data: () => data })
const owned = record('owned', { currentOwnerId: 'former', tenantId: 'former', status: 'active' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ dogs: [] }) })))
  f.getDocs.mockImplementation(async q => ({ docs: q.name === 'dogs' ? [owned] : [] }))
})

describe('transfer privacy loading', () => {
  it.each(['first-dog', 'second-dog'])('opens %s from history after live access is denied', async id => {
    f.getDoc.mockRejectedValue({ code: 'permission-denied' })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ snapshot: {
      id: 'snapshot', dog: { name: 'Before transfer', tenantId: 'former' },
      vaccineRecords: [{ id: 'old-vaccine' }],
    } }) } as Response)
    const result = await getDog(id)
    expect(result).toMatchObject({ id, name: 'Before transfer', currentOwnerId: '__historical__',
      _historySnapshot: { vaccineRecords: [{ id: 'old-vaccine' }] } })
    expect(f.getDocs).not.toHaveBeenCalled()
  })

  it('never renders a broadly readable current-owner document for the former owner', async () => {
    f.getDoc.mockResolvedValue({ exists: () => true, id: 'dog', data: () => ({ currentOwnerId: 'buyer', name: 'PRIVATE NEW NAME' }) })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ snapshot: {
      id: 'old', dog: { name: 'Old name', tenantId: 'former' },
    } }) } as Response)
    expect(await getDog('dog')).toMatchObject({ name: 'Old name', historicalSnapshot: true })
  })

  it('uses frozen history during pending claim, before currentOwnerId changes', async () => {
    f.getDoc.mockResolvedValue({ exists: () => true, id: 'dog', data: () => ({ currentOwnerId: 'former', status: 'transferred' }) })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ snapshot: {
      id: 'old', dog: { name: 'Frozen', tenantId: 'former' },
    } }) } as Response)
    expect(await getDog('dog')).toMatchObject({ name: 'Frozen', currentOwnerId: '__historical__' })
  })

  it('keeps a reacquired dog live instead of replacing it with older history', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ dogs: [{ id: 'owned', currentOwnerId: '__historical__', status: 'transferred' }] }) } as Response)
    expect(await getDogs()).toMatchObject([{ id: 'owned', currentOwnerId: 'former', status: 'active' }])
  })

  it('does not hide a history API outage as an empty dog list', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    await expect(getDogs()).rejects.toThrow('Failed to load dogs')
  })
})

describe('reminder isolation after transfer', () => {
  it('queries only currently owned dogs, including claimed dogs with the former tenantId', async () => {
    f.getDocs.mockImplementation(async q => q.name === 'dogs'
      ? { docs: [owned, record('claimed', { currentOwnerId: 'former', tenantId: 'other', status: 'active' })] }
      : { docs: [record(q.filters[0].value, { dogId: q.filters[0].value, tenantId: 'stale-tenant', status: 'pending' })] })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ dogs: [{ id: 'transferred', status: 'transferred', currentOwnerId: '__historical__' }] }) } as Response)
    expect((await getAllPendingReminders()).map(r => r.dogId)).toEqual(['owned', 'claimed'])
    const queries = f.getDocs.mock.calls.map(([q]) => q).filter(q => q.name === 'reminders')
    expect(queries.map(q => q.filters)).toEqual([
      [{ key: 'dogId', op: '==', value: 'owned' }],
      [{ key: 'dogId', op: '==', value: 'claimed' }],
    ])
  })

  it('queries every owned dog beyond one concurrency batch', async () => {
    f.getDocs.mockImplementation(async q => ({ docs: q.name === 'dogs'
      ? Array.from({ length: 41 }, (_, i) => record(`d${i}`, { currentOwnerId: 'former', status: 'active' })) : [] }))
    await getAllRemindersForUser('former')
    expect(f.getDocs.mock.calls.filter(([q]) => q.name === 'reminders')).toHaveLength(41)
  })

  it('rejects the whole result if any reminder query fails', async () => {
    f.getDocs.mockImplementation(async q => {
      if (q.name === 'dogs') return { docs: [owned] }
      throw { code: 'permission-denied' }
    })
    await expect(getAllPendingReminders()).rejects.toBeInstanceOf(GetRemindersError)
  })

  it('rejects a different userId before querying', async () => {
    await expect(getAllRemindersForUser('buyer')).rejects.toBeInstanceOf(GetRemindersError)
    expect(f.getDocs).not.toHaveBeenCalled()
  })
})
