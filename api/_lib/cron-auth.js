// api/_lib/cron-auth.js — fail-closed cron/internal-call authentication
// (Codex H4).
//
// The previous check (`header !== process.env.CRON_SECRET`) authorized
// NOBODY correctly when the secret was configured, but had one silent
// failure mode: if CRON_SECRET were ever unset/empty in a given
// environment, EVERY caller supplying no header at all would also compare
// as `undefined !== undefined` → false → "authorized". Confirmed live on
// idogs-app-staging before CRON_SECRET was configured there (2026-07-24).
// A missing/empty configured secret must fail closed with a distinct
// configuration-error response, never fall through to "no secret
// required".
//
// Two header shapes are accepted: Vercel's own "Authorization: Bearer
// <secret>" convention (for if/when this repo adopts vercel.json's
// built-in cron scheduler) and this repo's existing GitHub Actions
// "x-cron-secret: <secret>" header (see .github/workflows/*.yml) — either
// satisfies auth, so neither caller needs to change.
//
// Constant-time comparison (crypto.timingSafeEqual) — a naive `===`
// leaks a timing signal roughly proportional to the matching prefix
// length, which for a long-lived static secret is a real (if slow)
// side-channel.

import { timingSafeEqual } from 'node:crypto'

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — length is compared first (a length mismatch is not secret,
  // and this check itself needs no timing protection).
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Both candidate headers are collected independently (not "first present
// wins") — a caller sending an Authorization header with the WRONG token
// alongside a correct x-cron-secret must still be authorized by the
// correct one, not rejected because the first-checked header happened to
// be wrong.
function extractCandidateSecrets(req) {
  const candidates = []
  const bearer = req.headers?.['authorization']
  if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
    const token = bearer.slice(7).trim()
    if (token.length > 0) candidates.push(token)
  }
  const legacy = req.headers?.['x-cron-secret']
  if (typeof legacy === 'string' && legacy.length > 0) candidates.push(legacy)
  return candidates
}

// Returns { authorized: true } or { authorized: false, status, body } —
// callers should `return res.status(result.status).json(result.body)`
// unchanged on failure. Fails closed on every branch: unset secret,
// empty secret, missing header, empty header, and wrong value are all
// explicitly rejected — there is no code path that falls through to
// "authorized" without an exact constant-time match against a
// non-empty configured secret.
export function checkCronAuth(req) {
  const configured = process.env.CRON_SECRET
  if (typeof configured !== 'string' || configured.length === 0) {
    return { authorized: false, status: 500, body: { error: 'CRON_SECRET not configured' } }
  }
  const candidates = extractCandidateSecrets(req)
  if (candidates.length === 0) {
    return { authorized: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const matched = candidates.some(candidate => constantTimeEqual(candidate, configured))
  if (!matched) {
    return { authorized: false, status: 401, body: { error: 'Unauthorized' } }
  }
  return { authorized: true }
}
