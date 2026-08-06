// Shared policy for pre-transfer buyer access to one deposited puppy.
// This is intentionally separate from ownership: a grant is read-only,
// email-bound, and only remains valid while the granting breeder is still
// the dog's effective owner. The Dog document (and therefore Dog ID) never
// changes as access moves from public Showcase -> private buyer -> owner.

export function normalizeBuyerEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function effectiveOwnerId(dog) {
  if (!dog) return null
  return Object.prototype.hasOwnProperty.call(dog, 'currentOwnerId')
    ? dog.currentOwnerId
    : dog.tenantId || null
}

export function canManagePrivateDogAccess(dog, uid) {
  // This is a breeder pre-transfer capability, not a general sharing
  // primitive for later owners. The original tenant/breeder must still be
  // the effective current owner.
  return !!uid && dog?.tenantId === uid && effectiveOwnerId(dog) === uid
}

export function canGrantPrivateDogAccess(dog, uid) {
  return canManagePrivateDogAccess(dog, uid) && dog?.depositStatus === 'received'
}

export function grantAllowsBuyerRead(grant, dog, verifiedEmail) {
  const email = normalizeBuyerEmail(verifiedEmail)
  const grantEmail = normalizeBuyerEmail(grant?.buyerEmail)
  const pendingTransferMatchesGrant = dog?.status !== 'transferred' ||
    (!!normalizeBuyerEmail(dog?.buyerEmail) && normalizeBuyerEmail(dog?.buyerEmail) === grantEmail)
  return !!grant && grant.status === 'active' && !!email &&
    grantEmail === email && pendingTransferMatchesGrant &&
    grant.dogId && grant.dogId === dog?.id &&
    grant.grantedByUid && grant.grantedByUid === effectiveOwnerId(dog)
}

// Mirrors get-signed-url.js's document-path authorization shape. Never let
// a forged documents record turn this Admin endpoint into a signer for an
// unrelated Storage object.
export function isSafeDogDocumentPath(path, dog) {
  if (typeof path !== 'string') return false
  const parts = path.split('/')
  if (parts.length < 4 || parts[0] !== 'documents' || parts[2] !== dog?.id) return false
  return parts[1] === dog?.tenantId || parts[1] === dog?.currentOwnerId
}
