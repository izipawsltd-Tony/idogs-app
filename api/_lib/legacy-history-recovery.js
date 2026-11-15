// Recovery is an explicit backfill, never a live-data fallback for viewers.
export const RECOVERY_COLLECTIONS = ['vaccineRecords', 'wormingRecords', 'healthTests', 'activityNotes', 'documents', 'reminders', 'heatCycles']
function instant(value) {
  if (value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) return BigInt(value.seconds) * 1000000000n + BigInt(value.nanoseconds)
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? BigInt(value.getTime()) * 1000000n : null
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/)
  if (!m || !Number.isFinite(Date.parse(m[1] + 'Z'))) return null
  return BigInt(Date.parse(m[1] + 'Z')) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'))
}
export function existedAtTransfer(created, updated, cutoff) {
  const c = instant(created), u = instant(updated), t = instant(cutoff)
  return c !== null && u !== null && t !== null && c <= u && u <= t
}
// Legacy transfers saved dogs.transferredAt before the audit event was
// written (after the buyer email), so the two differ by seconds. The dog
// boundary is always the cutoff; the audit only corroborates it and must
// follow it within the window. It never extends the readable period.
export const TRANSFER_EVIDENCE_WINDOW_MS = 10 * 60 * 1000
export function transferCutoff(dogTransferredAt, auditTransferredAt) {
  const d = instant(dogTransferredAt), a = instant(auditTransferredAt)
  if (d === null || a === null || a < d || a - d > BigInt(TRANSFER_EVIDENCE_WINDOW_MS) * 1000000n) return null
  return dogTransferredAt
}
export function allowedHistoricalMedia(media, uid, dogId) {
  return typeof media?.path === 'string' && media.path.startsWith(`dogs/${uid}/${dogId}/`)
    && !media.path.includes('..') && /^\d+$/.test(media.generation)
}
const liveReferenceKeys = new Set(['photoUrl', 'fileUrl', 'url', 'documentUrl', 'downloadUrl', 'profilePhoto', 'storagePath', 'filePath', 'documentPath'])
function withoutLiveReferences(value) {
  if (Array.isArray(value)) return value.map(withoutLiveReferences)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && !liveReferenceKeys.has(key)).map(([key, item]) => [key, withoutLiveReferences(item)]))
}
export function makeRecoveredHistory({ legacy, records, media, recoveredAt }) {
  if (legacy?.historyAvailability !== 'audit_only' || !legacy.fromOwnerId || !legacy.dogId || instant(legacy.transferredAt) === null) throw Error('INVALID_TRANSFER_EVIDENCE')
  const snapshot = {
    snapshotVersion: 2, historyAvailability: 'recovered_partial',
    dogId: legacy.dogId, fromOwnerId: legacy.fromOwnerId,
    transferredAt: legacy.transferredAt, recoveredAt,
    recoveryMethod: 'verified_server_metadata',
    // Today's profile is not evidence of its state at the transfer boundary.
    dog: { id: legacy.dogId, tenantId: legacy.fromOwnerId, name: legacy.dog.name },
    auditEntries: withoutLiveReferences(legacy.auditEntries || []), recoveredMedia: [], recoveryOmissions: {},
  }
  for (const collection of RECOVERY_COLLECTIONS) {
    const all = records[collection] || []
    snapshot[collection] = all.filter(d => d.data?.dogId === legacy.dogId && existedAtTransfer(d.createTime, d.updateTime, legacy.transferredAt))
      .map(d => ({ ...withoutLiveReferences(d.data), id: d.id }))
    snapshot.recoveryOmissions[collection] = all.length - snapshot[collection].length
  }
  for (const item of media || []) {
    if (!allowedHistoricalMedia(item, legacy.fromOwnerId, legacy.dogId) || !existedAtTransfer(item.timeCreated, item.updated, legacy.transferredAt)) continue
    if (!snapshot.recoveredMedia.some(m => m.path === item.path)) snapshot.recoveredMedia.push({ path: item.path, generation: String(item.generation) })
  }
  return snapshot
}
