import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./firebase', () => ({ db: {}, auth: { currentUser: null } }))
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: vi.fn(() => 'wormingRecords'), addDoc: vi.fn().mockResolvedValue({ id: 'qa-worming' }), serverTimestamp: vi.fn(() => 'server-time'),
}))
import { addDoc } from 'firebase/firestore'
import { addWormingRecord } from './db'
beforeEach(() => vi.clearAllMocks())
describe('worming Firestore writes', () => {
  it('saves with optional values omitted rather than undefined', async () => {
    await expect(addWormingRecord({ dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', nextDue: undefined, weightKg: undefined })).resolves.toBe('qa-worming')
    expect(addDoc).toHaveBeenCalledWith('wormingRecords', { dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', createdAt: 'server-time' })
  })
  it('preserves supplied due date and numeric weight', async () => {
    await addWormingRecord({ dogId: 'qa', product: 'QA-only', dateGiven: '2026-10-06', nextDue: '2026-10-31', weightKg: 20 })
    expect(addDoc).toHaveBeenCalledWith('wormingRecords', expect.objectContaining({ nextDue: '2026-10-31', weightKg: 20 }))
  })
})
