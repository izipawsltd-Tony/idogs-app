// Deterministic incident lifecycle for an independent scheduler. An HTTP
// failure and a probe's inability to observe the site are different incidents.
// Replayed, invalid and future observations cannot open or resolve incidents.
export function advanceMonitor(previous, observation, { now = new Date(), threshold = 2 } = {}) {
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 10) throw new Error('Invalid incident threshold')
  const at = Date.parse(observation?.checkedAt)
  const priorAt = Date.parse(previous?.lastCheckedAt)
  if (!Number.isFinite(at) || !Number.isFinite(now.getTime()) || at > now.getTime() || (Number.isFinite(priorAt) && at <= priorAt)
    || !['PASS', 'FAIL', 'UNKNOWN'].includes(observation?.status)) throw new Error('Invalid or replayed health observation')
  if (previous && (previous.version !== 1 || !Number.isFinite(priorAt) || !['HEALTHY', 'HTTP_FAILURE', 'OBSERVATION_GAP'].includes(previous.condition)
    || !Number.isSafeInteger(previous.streak) || previous.streak < 1
    || (previous.incident !== null && (!previous.incident || typeof previous.incident.id !== 'string' || !['HTTP_FAILURE', 'OBSERVATION_GAP'].includes(previous.incident.kind))))) throw new Error('Invalid monitor state')
  const condition = observation.status === 'PASS' ? 'HEALTHY' : observation.status === 'FAIL' ? 'HTTP_FAILURE' : 'OBSERVATION_GAP'
  const streak = previous?.condition === condition ? Math.min(previous.streak + 1, threshold) : 1
  let incident = previous?.incident || null
  const events = []
  if (condition === 'HEALTHY' && streak >= threshold && incident) {
    events.push({ type: 'RESOLVED', incidentId: incident.id, kind: incident.kind, at: observation.checkedAt })
    incident = null
  } else if (condition !== 'HEALTHY' && streak >= threshold && incident?.kind !== condition) {
    if (incident) events.push({ type: 'SUPERSEDED', incidentId: incident.id, kind: incident.kind, at: observation.checkedAt })
    incident = { id: `${condition}-${new Date(at).toISOString()}`, kind: condition, openedAt: observation.checkedAt }
    events.push({ type: 'OPENED', incidentId: incident.id, kind: condition, at: observation.checkedAt })
  }
  return { state: { version: 1, lastCheckedAt: observation.checkedAt, condition, streak, incident }, events }
}
