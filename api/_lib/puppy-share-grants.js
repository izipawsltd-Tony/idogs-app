// api/_lib/puppy-share-grants.js — shared validation/helpers for the
// Private Puppy Update Links feature (puppyShareGrants/{grantId}).
//
// Deliberately reuses this codebase's EXISTING token/ownership primitives
// rather than reimplementing them: generateShareToken/hashShareToken/
// isValidExpiryIso/MAX_SHARE_EXPIRY_DAYS come from api/_lib/showcase-share.js
// (Litter Showcase's own share-link primitives — sha256 hashing, CSPRNG
// generation, expiry bounds), and effectiveOwnerId comes from
// api/_lib/private-dog-access.js (the existing pre-transfer buyer-access
// feature's own ownership resolver). Neither source file is imported for
// write access and neither is modified by this feature — both stay
// completely independent of puppyShareGrants.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { generateShareToken, hashShareToken, isValidExpiryIso, MAX_SHARE_EXPIRY_DAYS } from './showcase-share.js'
import { effectiveOwnerId } from './private-dog-access.js'

export { generateShareToken, hashShareToken, isValidExpiryIso, MAX_SHARE_EXPIRY_DAYS, effectiveOwnerId }

// Same permissive control-character-strip + trim + hard length cap as
// api/_lib/enquiry-schema.js's own (unexported) cleanString() helper —
// mirrored here rather than imported, because that helper isn't exported
// from its module. Unlike api/support/_shared.js's plainText(), this
// NEVER throws on an empty/absent value — customerLabel is optional —
// and returns null (never '') so a caller can write it straight to
// Firestore as an explicit "unset" value.
export const MAX_CUSTOMER_LABEL_LENGTH = 120

export function cleanCustomerLabel(value) {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
  return stripped ? stripped.slice(0, MAX_CUSTOMER_LABEL_LENGTH) : null
}

// puppyIds: exactly 1 or 2 entries, each a non-empty string, no
// duplicates. Returns the validated array unchanged (original order
// preserved) or null — deliberately returns null rather than throwing,
// since this module is a pure-function helper library; callers own the
// ApiError/status-code decision.
export function validatePuppyIds(value) {
  if (!Array.isArray(value)) return null
  if (value.length < 1 || value.length > 2) return null
  if (!value.every(id => typeof id === 'string' && id.trim() !== '')) return null
  if (new Set(value).size !== value.length) return null
  return value
}

// A breeder must be able to Share/Copy an existing customer link again
// after a reload or on another device, while preserving the original
// random link and without ever storing a raw token. We derive a stable,
// recoverable alias from the grant's existing 256-bit tokenHash. The raw
// alias is never stored. Reset changes tokenHash, so both the original
// link and every derived alias become invalid together, preserving reset
// semantics.
//
// The token contains only an opaque Firestore grant id plus an HMAC. It
// never contains a puppy id, owner id, email, customer label, or raw
// tokenHash. The HMAC key is tokenHash, which has the entropy of the
// original CSPRNG token and is server-only.
const COPY_TOKEN_VERSION = 'v1'
const COPY_TOKEN_PURPOSE = 'puppy-share-copy'

function copySignature(grantId, tokenHash) {
  return createHmac('sha256', String(tokenHash))
    .update(`${COPY_TOKEN_PURPOSE}:${COPY_TOKEN_VERSION}:${grantId}`)
    .digest('base64url')
}

export function deriveCopyShareToken(grantId, tokenHash) {
  if (typeof grantId !== 'string' || !grantId || typeof tokenHash !== 'string' || !tokenHash) return null
  const payload = `${COPY_TOKEN_VERSION}:${grantId}:${copySignature(grantId, tokenHash)}`
  return Buffer.from(payload, 'utf8').toString('base64url')
}

export function parseCopyShareToken(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  let decoded
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const parts = decoded.split(':')
  if (parts.length !== 3 || parts[0] !== COPY_TOKEN_VERSION) return null
  const [, grantId, signature] = parts
  if (!grantId || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null
  return { grantId, signature }
}

export function verifyCopyShareToken(value, tokenHash) {
  const parsed = parseCopyShareToken(value)
  if (!parsed || typeof tokenHash !== 'string' || !tokenHash) return null
  const expected = copySignature(parsed.grantId, tokenHash)
  try {
    const actualBuffer = Buffer.from(parsed.signature, 'base64url')
    const expectedBuffer = Buffer.from(expected, 'base64url')
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
  } catch {
    return null
  }
  return parsed.grantId
}

// Loose shape/charset check on a caller-supplied raw share token BEFORE
// it is ever hashed or looked up — lets api/puppy-share-view.js reject an
// obviously-malformed value with zero Firestore reads, and without ever
// needing to log the value to explain why (see that file's own comment).
// generateShareToken() (showcase-share.js) produces
// randomBytes(32).toString('base64url') — 43 base64url characters, no
// padding — but this check is intentionally a little looser (32-128,
// base64url charset only) so a plausible-but-not-exactly-43-char value
// still reaches the real hash+lookup rather than being rejected on a
// brittle exact-length assumption.
export function isPlausibleShareToken(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

// Strips the fields a client must never receive back: tokenHash and any
// other server-only token material. Every breeder-facing response
// (create/list/manage) goes through this — the public, unauthenticated
// view builds its own, separately allowlisted response shape.
export function serializeGrant(id, data) {
  return {
    id,
    ownerId: data.ownerId,
    puppyIds: data.puppyIds,
    customerLabel: data.customerLabel ?? null,
    status: data.status,
    expiresAt: data.expiresAt ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || null,
    lastResetAt: data.lastResetAt?.toDate?.()?.toISOString() || data.lastResetAt || null,
  }
}
