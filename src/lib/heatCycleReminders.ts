// Reminders that belong to one heat cycle (Owner 19/11/2026, Issue #69:
// deleting a heat cycle must delete its linked reminders too).
//
// Two link shapes exist:
// - created in the app (Mating due, pregnancy timeline):
//   source 'breeding_timeline' + sourceRef = heat cycle id
// - created by the daily reminders job (api/send-reminders.js):
//   heatCycleId = heat cycle id
export interface HeatCycleLinkable {
  id: string
  dogId?: string
  source?: string
  sourceRef?: string
  heatCycleId?: string
}

export function remindersLinkedToHeatCycle<T extends HeatCycleLinkable>(
  reminders: T[],
  cycleId: string,
  dogId?: string,
): T[] {
  if (!cycleId) return []
  return reminders.filter(r =>
    (!dogId || r.dogId === dogId)
    && ((r.source === 'breeding_timeline' && r.sourceRef === cycleId) || r.heatCycleId === cycleId)
  )
}
