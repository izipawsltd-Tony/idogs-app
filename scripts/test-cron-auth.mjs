// scripts/test-cron-auth.mjs — tests for api/_lib/cron-auth.js (Codex
// H4: missing/empty CRON_SECRET must authorize nobody).
//
// Usage: node scripts/test-cron-auth.mjs

import { makeChecker } from './_lib/test-check.mjs'
import { checkCronAuth } from '../api/_lib/cron-auth.js'

const { check, summary } = makeChecker()

const ORIGINAL_SECRET = process.env.CRON_SECRET

function withEnv(value, fn) {
  if (value === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = value
  try {
    return fn()
  } finally {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  }
}

function reqWith(headers) {
  return { headers }
}

// ── Fail-closed on missing/empty configured secret ───────────────────

check('CRON_SECRET unset: rejected even with no header at all (the exact live staging bug)', withEnv(undefined, () => {
  const result = checkCronAuth(reqWith({}))
  return result.authorized === false && result.status === 500
}))

check('CRON_SECRET unset: rejected even if caller sends a matching-looking header', withEnv(undefined, () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': 'undefined' }))
  return result.authorized === false && result.status === 500
}))

check('CRON_SECRET empty string: rejected, not treated as "no secret required"', withEnv('', () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': '' }))
  return result.authorized === false && result.status === 500
}))

// ── Configured secret: missing/empty/wrong header ─────────────────────

check('configured secret, no header at all: 401', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({}))
  return result.authorized === false && result.status === 401
}))

check('configured secret, empty x-cron-secret header: 401', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': '' }))
  return result.authorized === false && result.status === 401
}))

check('configured secret, wrong x-cron-secret value: 401', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': 'wrong-value' }))
  return result.authorized === false && result.status === 401
}))

check('configured secret, a value that is a prefix of the real secret: 401 (no partial match)', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': 'real-secret' }))
  return result.authorized === false && result.status === 401
}))

check('configured secret, Authorization header with wrong Bearer token: 401', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ authorization: 'Bearer wrong-token' }))
  return result.authorized === false && result.status === 401
}))

check('configured secret, malformed Authorization header (no Bearer prefix): 401', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ authorization: 'real-secret-value' }))
  return result.authorized === false && result.status === 401
}))

// ── Configured secret, correct value: both accepted header shapes ────

check('configured secret, correct x-cron-secret (GitHub Actions shape): authorized', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ 'x-cron-secret': 'real-secret-value' }))
  return result.authorized === true
}))

check('configured secret, correct Authorization: Bearer <secret> (Vercel shape): authorized', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ authorization: 'Bearer real-secret-value' }))
  return result.authorized === true
}))

check('both headers present and correct: authorized (no conflict)', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ authorization: 'Bearer real-secret-value', 'x-cron-secret': 'real-secret-value' }))
  return result.authorized === true
}))

check('Authorization present but wrong, x-cron-secret present and correct: authorized (either header suffices)', withEnv('real-secret-value', () => {
  const result = checkCronAuth(reqWith({ authorization: 'Bearer wrong', 'x-cron-secret': 'real-secret-value' }))
  return result.authorized === true
}))

// ── Different-length secrets never throw (timingSafeEqual guard) ─────

check('a provided secret of a totally different length than the configured one does not throw', withEnv('short', () => {
  try {
    const result = checkCronAuth(reqWith({ 'x-cron-secret': 'a-much-much-longer-provided-value-than-configured' }))
    return result.authorized === false && result.status === 401
  } catch {
    return false
  }
}))

await summary()
