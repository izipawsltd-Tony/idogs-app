// Legacy transfers have no frozen clinical record. Use only the caller's
// own audit trail; never reconstruct history from the new owner's live dog.
export function legacyTransferHistory(entries, uid) {
  const latest = new Map()
  for (const entry of entries) {
    if (entry.tenantId !== uid || entry.action !== 'dog_transferred' || !entry.dogId) continue
    const at = typeof entry.createdAt === 'string' ? entry.createdAt : ''
    if (!Number.isFinite(Date.parse(at))) continue
    if (!latest.has(entry.dogId) || at > latest.get(entry.dogId).createdAt) latest.set(entry.dogId, entry)
  }
  return Array.from(latest.values()).map(transfer => ({
    id: `audit-${transfer.id}`,
    snapshotVersion: 0,
    historyAvailability: 'audit_only',
    dogId: transfer.dogId,
    fromOwnerId: uid,
    transferredAt: transfer.createdAt,
    dog: { id: transfer.dogId, name: transfer.dogName || 'Transferred dog', tenantId: uid },
    auditEntries: entries.filter(e => e.tenantId === uid && e.dogId === transfer.dogId
      && Number.isFinite(Date.parse(e.createdAt)) && e.createdAt <= transfer.createdAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(e => ({ id: e.id, action: e.action, details: e.details, createdAt: e.createdAt })),
  }))
}
