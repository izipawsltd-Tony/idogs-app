import { beforeEach, describe, expect, it, vi } from 'vitest'
const qa = vi.hoisted(() => ({ set: vi.fn(), owner: 'qa-owner' }))
vi.mock('./firebase', () => ({ db: {}, auth: { currentUser: { uid: 'qa-owner' } } }))
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (...args: any[]) => args.length === 1 ? { id: 'qa-worming', name: args[0].name } : { id: args[2], name: args[1] },
  serverTimestamp: () => 'server-time',
  runTransaction: async (_db: unknown, fn: any) => fn({
    get: async () => ({ exists: () => true, data: () => ({ currentOwnerId: qa.owner, tenantId: 'former-owner' }) }),
    set: qa.set,
  }),
}))
import { addWormingRecord } from './db'
beforeEach(() => { vi.clearAllMocks(); qa.owner = 'qa-owner' })
describe('worming Firestore writes', () => {
  it('saves with optional values omitted rather than undefined', async () => {
    await expect(addWormingRecord({ dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', nextDue: undefined, weightKg: undefined })).resolves.toBe('qa-worming')
    expect(qa.set).toHaveBeenCalledTimes(1)
    expect(qa.set).toHaveBeenCalledWith({ name: 'wormingRecords', id: 'qa-worming' }, { dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', createdAt: 'server-time' })
  })
  it('saves the record and deterministic reminder together for the current owner', async () => {
    await addWormingRecord({ dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', nextDue: '2026-10-31', weightKg: 20 })
    expect(qa.set).toHaveBeenCalledTimes(2)
    expect(qa.set).toHaveBeenCalledWith({ name: 'wormingRecords', id: 'qa-worming' }, expect.objectContaining({ nextDue: '2026-10-31', weightKg: 20 }))
    expect(qa.set).toHaveBeenCalledWith({ name: 'reminders', id: 'worming_qa_qa-worming' }, expect.objectContaining({ tenantId: 'qa-owner', dueDate: '2026-10-31' }))
  })
  it('does not write either record when another person currently owns the dog', async () => {
    qa.owner = 'buyer'
    await expect(addWormingRecord({ dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', nextDue: '2026-10-31' })).rejects.toThrow('Current owner required')
    expect(qa.set).not.toHaveBeenCalled()
  })
})
