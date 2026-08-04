// api/_lib/showcase-share.js — shared helpers for the Litter Showcase
// public share link (Slice 2).
//
// The raw share token is generated here, returned to the caller exactly
// once (see api/rotate-showcase-share.js), and NEVER persisted anywhere
// — only its sha256 hash (LitterShowcase.shareTokenHash) is stored, so a
// Firestore data leak/backup exposure can't hand out a working link.
// api/showcase-public.js looks a Showcase up by matching this hash
// against sha256(suppliedToken) — the litterId (Firestore doc id) is
// never part of the public URL and never authorizes anything on its
// own; only a correct token does.

import { randomBytes, createHash } from 'crypto'
import { computeEffectivePlan } from './entitlements.js'

// 32 bytes (256 bits) of CSPRNG entropy, base64url-encoded (URL-safe,
// no padding) — long enough that guessing/enumerating a valid token is
// not a practical attack, short enough to be a reasonable URL segment.
export function generateShareToken() {
  return randomBytes(32).toString('base64url')
}

export function hashShareToken(rawToken) {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

// A Showcase is publicly reachable iff: it has a token at all (been
// rotated at least once), the breeder has explicitly turned public
// sharing on (`shareEnabled`, independent of Slice 1's `enabled`), the
// underlying Showcase itself is still `enabled` (a breeder disabling
// their Showcase outright must also take the public link down, even if
// `shareEnabled` was never separately toggled off), and — if an expiry
// was set — that expiry hasn't passed yet. `now` is injected (not read
// internally via `new Date()`) so callers/tests can pass a fixed clock.
export function isShareLive(showcase, now = new Date()) {
  if (!showcase) return false
  if (!showcase.shareTokenHash) return false
  if (!showcase.shareEnabled) return false
  if (!showcase.enabled) return false
  if (showcase.shareExpiresAt) {
    const expiry = new Date(showcase.shareExpiresAt)
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) return false
  }
  return true
}

// Bounds how far in the future a breeder can set an expiry — generous
// (2 years) but not literally unbounded, so a malformed/huge client
// value can't be persisted verbatim. `null` (no expiry) is always
// allowed and validated separately by callers.
export const MAX_SHARE_EXPIRY_DAYS = 730

export function isValidExpiryIso(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  const maxMs = Date.now() + MAX_SHARE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  return d.getTime() <= maxMs
}

// Integration-hardening fix (Slice 2, commit 5/5): Litter Showcase is a
// Plus-plan feature — api/create-showcase.js/rotate-showcase-share.js
// etc. all gate on checkBreederPlusAccess() before letting a breeder
// CREATE or manage one. But neither api/showcase-public.js nor
// api/create-showcase-enquiry.js re-checked the tenant's CURRENT plan at
// PUBLIC READ/enquiry time — isShareLive() only ever looked at the
// Showcase document's own flags. A breeder who downgraded to Free after
// publishing a link would keep it working indefinitely, which
// contradicts "Keep plan restrictions authoritative" (this Slice's own
// SECURITY requirement) — the public-facing benefit of a Plus-only
// feature must not outlive the subscription that unlocked it. Callers
// pass a freshly-read users/{uid} profile (never trust a cached/stale
// one) and treat a non-Plus-eligible tenant exactly like every other
// "not live" reason: the same generic 404/not-found response, never a
// distinguishing signal.
export function isTenantPlusEligible(profile) {
  return computeEffectivePlan(profile) === 'plus'
}
