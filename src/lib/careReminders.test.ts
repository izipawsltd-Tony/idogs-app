import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ uid: 'owner', dogs: new Map<string, any>(), records: new Map<string, any>(), writes: [] as any[], nextId: 0 }))
vi.mock('./firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: f.uid } } } }))
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, name: string) => ({ name }),
  doc: (db: any, name?: string, id?: string) => typeof name === 'string' ? { name, id } : { name: db.name, id: `auto${++f.nextId}` },
  runTransaction: async (_: unknown, cb: any) => {
    const writes: any[] = []
    const result = await cb({
      get: async (ref: any) => { const value = ref.name === 'dogs' ? f.dogs.get(ref.id) : f.records.get(`${ref.name}/${ref.id}`); return { exists: () => !!value, data: () => value } },
      set: (ref: any, data: any) => writes.push({ op: 'set', ref, data }),
      update: (ref: any, data: any) => writes.push({ op: 'update', ref, data }),
    })
    for (const w of writes) { f.writes.push(w); const key = `${w.ref.name}/${w.ref.id}`; f.records.set(key, w.op === 'update' ? { ...f.records.get(key), ...w.data } : w.data) }
    return result
  },
  serverTimestamp: () => 'server-time',
  getDoc: vi.fn(), getDocs: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), query: vi.fn(), where: vi.fn(), setDoc: vi.fn(), Timestamp: class {}, deleteField: vi.fn(),
}))
import { addReminder, addWormingRecord, addWormingReminder } from './db'
beforeEach(() => { f.uid = 'owner'; f.dogs.clear(); f.records.clear(); f.writes = []; f.nextId = 0; f.dogs.set('dog', { currentOwnerId: 'owner', tenantId: 'breeder', status: 'active' }) })
describe('care reminder transactions', () => {
  it('saves a worming record and its reminder atomically with the scheduler ID', async () => {
    const id = await addWormingRecord({ dogId: 'dog', product: 'Treatment', dateGiven: '2026-10-19', nextDue: '2026-11-19', weightKg: undefined })
    expect(f.writes).toHaveLength(2)
    expect(f.writes[0].data).not.toHaveProperty('weightKg')
    expect(f.writes[1]).toMatchObject({ ref: { id: `worming_dog_${id}` }, data: { tenantId: 'owner', type: 'worming', dueDate: '2026-11-19' } })
  })
  it('does not invent a next dose date', async () => {
    await addWormingRecord({ dogId: 'dog', product: 'Treatment', dateGiven: '2026-10-19' })
    expect(f.writes).toHaveLength(1)
  })
  it.each(['transferred', 'other-owner', 'missing'])('blocks record and reminder writes for %s dogs', async state => {
    if (state === 'transferred') f.dogs.set('dog', { currentOwnerId: 'owner', status: 'transferred' })
    if (state === 'other-owner') f.dogs.set('dog', { currentOwnerId: 'other', tenantId: 'owner' })
    if (state === 'missing') f.dogs.clear()
    await expect(addWormingRecord({ dogId: 'dog', product: 'Treatment', dateGiven: '2026-10-19', nextDue: '2026-11-19' })).rejects.toThrow()
    await expect(addReminder({ dogId: 'dog', tenantId: 'owner', type: 'custom', title: 'Care', dueDate: '2026-11-19', notifyDaysBefore: 0, status: 'pending' })).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
  })
  it('creates one reminder for an existing treatment and keeps retries idempotent', async () => {
    f.records.set('wormingRecords/worm', { dogId: 'dog', product: 'Treatment' })
    await addWormingReminder('dog', 'worm', '2026-11-19')
    await addWormingReminder('dog', 'worm', '2026-11-19')
    expect(f.writes.filter(w => w.ref.name === 'reminders')).toHaveLength(1)
    expect(f.records.get('wormingRecords/worm')).toMatchObject({ nextDue: '2026-11-19' })
  })
  it('refuses a treatment from a different dog', async () => {
    f.records.set('wormingRecords/worm', { dogId: 'other', product: 'Treatment' })
    await expect(addWormingReminder('dog', 'worm', '2026-11-19')).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
  })
  it('saves manual reminders for the current owner even when breeder tenant differs', async () => {
    await addReminder({ dogId: 'dog', tenantId: 'owner', type: 'dental_care', title: '  Teeth  ', dueDate: '2026-11-19', notifyDaysBefore: 3, status: 'pending', source: 'manual' })
    expect(f.writes[0].data).toMatchObject({ tenantId: 'owner', title: 'Teeth', type: 'dental_care' })
  })
  it('refuses another tenant identity', async () => {
    await expect(addReminder({ dogId: 'dog', tenantId: 'breeder', type: 'custom', title: 'Care', dueDate: '2026-11-19', notifyDaysBefore: 0, status: 'pending' })).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
  })
})
