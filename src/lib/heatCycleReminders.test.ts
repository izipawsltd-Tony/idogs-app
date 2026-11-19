import { describe, expect, it } from 'vitest'
import { remindersLinkedToHeatCycle } from './heatCycleReminders'

const reminders = [
  { id: 'a', dogId: 'd1', source: 'breeding_timeline', sourceRef: 'c1', milestoneKey: 'mating_due' },
  { id: 'b', dogId: 'd1', source: 'breeding_timeline', sourceRef: 'c1', milestoneKey: 'due_day63' },
  { id: 'c', dogId: 'd1', heatCycleId: 'c1' }, // daily reminders job
  { id: 'd', dogId: 'd1', source: 'breeding_timeline', sourceRef: 'c2' }, // other cycle
  { id: 'e', dogId: 'd1', sourceRef: 'c1' }, // not a breeding link (no source)
  { id: 'f', dogId: 'd1', type: 'worming' }, // unrelated care reminder
  { id: 'g', dogId: 'd2', heatCycleId: 'c1' }, // other dog
]

describe('remindersLinkedToHeatCycle', () => {
  it('returns app-created and job-created reminders of that cycle only', () => {
    expect(remindersLinkedToHeatCycle(reminders, 'c1', 'd1').map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('never matches other cycles, unrelated reminders or an empty id', () => {
    expect(remindersLinkedToHeatCycle(reminders, 'c2', 'd1').map(r => r.id)).toEqual(['d'])
    expect(remindersLinkedToHeatCycle(reminders, '', 'd1')).toEqual([])
    expect(remindersLinkedToHeatCycle(reminders, 'zzz', 'd1')).toEqual([])
  })
})
