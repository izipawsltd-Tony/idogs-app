function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
export function normalizeAuditIdentity(data, usersMap = {}) {
  const targetUserId = text(data.targetUserId) || text(data.target?.uid) || null
  const targetProfile = targetUserId ? usersMap[targetUserId] : null
  const targetUserEmail = text(data.targetUserEmail) || text(data.target?.email) || targetProfile?.email || null
  const targetOrganisationId = text(data.targetOrganisationId) || (data.target?.role === 'breeder' ? targetUserId : null)
  const organisationProfile = targetOrganisationId ? usersMap[targetOrganisationId] : null
  const targetOrganisationName = text(data.targetOrganisationName) || text(data.target?.organisationName) || organisationProfile?.name || null

  return {
    targetUserId,
    targetUserEmail,
    targetOrganisationId,
    targetOrganisationName,
    reason: text(data.reason),
    beforeState: data.beforeState && typeof data.beforeState === 'object' ? data.beforeState : null,
    afterState: data.afterState && typeof data.afterState === 'object' ? data.afterState : null,
    outcome: text(data.outcome),
    providerMessageId: text(data.providerMessageId),
  }
}
