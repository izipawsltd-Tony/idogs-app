import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { wormingEditChanges } from './wormingEdit'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const base = { product: ' Drontal ', dateGiven: '2026-10-01', nextDue: '2027-01-01', weightKg: '4.2' }

describe('worming edit', () => {
  it('trims the product and keeps every filled field', () => {
    expect(wormingEditChanges(base)).toEqual({ set: { product: 'Drontal', dateGiven: '2026-10-01', nextDue: '2027-01-01', weightKg: 4.2 }, clear: [] })
  })

  it('removes cleared optional fields instead of storing empty values', () => {
    expect(wormingEditChanges({ ...base, nextDue: '', weightKg: ' ' })).toEqual({ set: { product: 'Drontal', dateGiven: '2026-10-01' }, clear: ['nextDue', 'weightKg'] })
  })

  it('rejects missing or invalid values', () => {
    expect(() => wormingEditChanges({ ...base, product: '  ' })).toThrow(/Product/)
    expect(() => wormingEditChanges({ ...base, dateGiven: '' })).toThrow(/Date given/)
    expect(() => wormingEditChanges({ ...base, nextDue: '01/01/2027' })).toThrow(/next due/)
    for (const weightKg of ['0', '-1', 'abc', '500']) expect(() => wormingEditChanges({ ...base, weightKg })).toThrow(/Weight/)
  })

  it('updates through one current-owner transaction that keeps the dog link and the reminder in step', () => {
    const db = read('./db.ts')
    const fn = db.slice(db.indexOf('export async function updateWormingRecord'), db.indexOf('export async function deleteWormingRecord'))
    expect(fn).toContain('runTransaction')
    expect(fn).toContain("dog.data().status === 'transferred'")
    expect(fn).toContain('worm.data().dogId !== dogId')
    expect(fn).toContain('`worming_${dogId}_${wormingId}`')
    expect(fn).toContain("status !== 'completed'")
    expect(fn).not.toMatch(/dogId:\s*set|tenantId:\s*set/)
  })

  it('shows Edit between the Current/Overdue status and Add reminder, for the current owner only', () => {
    const page = read('../pages/DogDetailPage.tsx')
    const tab = page.slice(page.indexOf('function WormingTab'), page.indexOf('// ── HEALTH TAB'))
    const status = tab.indexOf("'Overdue' : 'Current'")
    const edit = tab.indexOf('onClick={() => startEdit(w)}')
    const reminder = tab.indexOf('>Add reminder</button>')
    expect(status).toBeGreaterThan(0)
    expect(edit).toBeGreaterThan(status)
    expect(reminder).toBeGreaterThan(edit)
    expect(tab.slice(tab.lastIndexOf('{canEdit && <button', edit), edit)).toContain('className="btn btn-secondary btn-sm"')
    expect(tab).toContain('editingId === w.id && canEdit')
  })
})

describe('worming reminder state (Owner QA 176: Add reminder still shown after saving)', () => {
  const base = { dogId: 'd1', type: 'worming', title: 'Worming: Drontal', dueDate: '2027-11-01', notifyDaysBefore: 3, createdAt: '' } as const
  it('finds the pending reminder for that record only', async () => {
    const { activeWormingReminder } = await import('./wormingEdit')
    const reminders = [
      { ...base, id: 'worming_d1_w1', status: 'pending' as const },
      { ...base, id: 'worming_d1_w2', status: 'completed' as const },
      { ...base, id: 'worming_d2_w3', dogId: 'd2', status: 'pending' as const },
    ]
    expect(activeWormingReminder(reminders, 'd1', 'w1')?.id).toBe('worming_d1_w1')
    expect(activeWormingReminder(reminders, 'd1', 'w2')).toBeUndefined()
    expect(activeWormingReminder(reminders, 'd1', 'w3')).toBeUndefined()
    expect(activeWormingReminder([{ ...base, id: 'other', status: 'overdue' as const, wormingId: 'w9' } as never], 'd1', 'w9')?.id).toBe('other')
  })
  it('the row shows the reminder instead of Add reminder while one is active', () => {
    const page = read('../pages/DogDetailPage.tsx')
    const tab = page.slice(page.indexOf('function WormingTab'), page.indexOf('// ── HEALTH TAB'))
    const check = tab.indexOf('activeWormingReminder(reminders, dogId, w.id)')
    expect(check).toBeGreaterThan(0)
    expect(tab.indexOf('data-testid="worming-reminder-set"')).toBeGreaterThan(check)
    expect(tab.indexOf('>Add reminder</button>')).toBeGreaterThan(tab.indexOf('data-testid="worming-reminder-set"'))
    expect(page).toContain("<WormingTab onReminderSaved={refreshReminders} reminders={reminders} ")
  })
})
