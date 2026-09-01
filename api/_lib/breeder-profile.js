import { createHash } from 'node:crypto'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBreederId(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function normalizeEmail(value) {
  return text(value).toLowerCase()
}

export function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('61') && digits.length >= 10) return `+${digits}`
  if (digits.startsWith('0') && digits.length >= 9) return `+61${digits.slice(1)}`
  return digits
}

function hashIdentity(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

export function breederIdentity(profile = {}, { uid = '', authEmail = '' } = {}) {
  const breederIdValue = normalizeBreederId(profile.breederIdValue)
  const breederIdType = text(profile.breederIdType).toUpperCase()
  if (breederIdValue) {
    const key = `breeder:${breederIdType || 'UNKNOWN'}:${breederIdValue}`
    return { kind: 'breeder_id', key, breederProfileId: `bp_${hashIdentity(key)}` }
  }

  const phone = normalizePhone(profile.phone)
  if (phone) {
    const key = `phone:${phone}`
    return { kind: 'phone', key, breederProfileId: `bp_${hashIdentity(key)}` }
  }

  const email = normalizeEmail(profile.email || authEmail)
  if (email) {
    const key = `email:${email}`
    return { kind: 'email', key, breederProfileId: `bp_${hashIdentity(key)}` }
  }

  const safeUid = text(uid)
  const key = `uid:${safeUid || 'unknown'}`
  return { kind: 'uid', key, breederProfileId: `bp_${hashIdentity(key)}` }
}

function sameStrongIdentity(profile, target, authEmail = '') {
  if (target.kind === 'breeder_id') {
    const value = normalizeBreederId(profile?.breederIdValue)
    const type = text(profile?.breederIdType).toUpperCase() || 'UNKNOWN'
    return target.key === `breeder:${type}:${value}`
  }
  if (target.kind === 'phone') {
    return target.key === `phone:${normalizePhone(profile?.phone)}`
  }
  if (target.kind === 'email') {
    return target.key === `email:${normalizeEmail(profile?.email || authEmail)}`
  }
  return false
}

// Returns UIDs whose stored profile carries the same strongest available
// breeder identity as the authenticated account. This is only a legacy
// compatibility bridge: new quota-ledger entries carry breederProfileId
// directly, so account recreation with the same normalized Breeder ID,
// phone, or email converges on the same deterministic profile id.
//
// Queries use the raw stored value from the current profile because this
// repo deliberately avoids broad collection scans. We then normalize and
// re-check every hit before accepting it. Formatting-variant historical
// profiles can still miss this bridge, but all entries written from this
// feature onward are protected by the normalized breederProfileId itself.
export async function relatedTenantIdsForBreederTx(tx, db, { uid, profile = {}, authEmail = '' }) {
  const ids = new Set([uid])
  const target = breederIdentity(profile, { uid, authEmail })

  let query = null
  if (target.kind === 'breeder_id' && text(profile.breederIdValue)) {
    query = db.collection('users').where('breederIdValue', '==', profile.breederIdValue)
  } else if (target.kind === 'phone' && text(profile.phone)) {
    query = db.collection('users').where('phone', '==', profile.phone)
  } else if (target.kind === 'email') {
    const storedEmail = text(profile.email || authEmail)
    if (storedEmail) query = db.collection('users').where('email', '==', storedEmail)
  }

  if (!query) return { breederProfileId: target.breederProfileId, identityKind: target.kind, tenantIds: [...ids] }

  const snap = await tx.get(query)
  for (const doc of snap.docs) {
    const candidate = doc.data()
    if (sameStrongIdentity(candidate, target, authEmail)) ids.add(doc.id)
  }

  return {
    breederProfileId: target.breederProfileId,
    identityKind: target.kind,
    tenantIds: [...ids],
  }
}
