// ADR-002 Phase C1 — unit tests for api/_lib/rate-limit.js, run directly
// against the real module (no emulator needed — this is pure in-process
// logic with no Firestore/Auth dependency).
//
// Usage: node scripts/test-passport-rate-limit.mjs

import { checkRateLimit, hashClientKey, getClientIp, __resetForTests } from '../api/_lib/rate-limit.js'

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// ── requests below limit succeed ──
__resetForTests()
{
  const key = 'test-key-below-limit'
  let allAllowed = true
  for (let i = 0; i < 5; i++) {
    const result = checkRateLimit(key, 60_000, 10)
    if (!result.allowed) allAllowed = false
  }
  check('5 requests under a limit of 10 all succeed', allAllowed)
}

// ── excess requests return blocked with Retry-After info ──
__resetForTests()
{
  const key = 'test-key-excess'
  const limit = 3
  let blockedResult = null
  for (let i = 0; i < limit + 2; i++) {
    const result = checkRateLimit(key, 60_000, limit)
    if (!result.allowed && !blockedResult) blockedResult = result
  }
  check('Requests beyond the limit are blocked', blockedResult !== null)
  check('Blocked result includes a positive retryAfterSeconds', blockedResult && blockedResult.retryAfterSeconds > 0, JSON.stringify(blockedResult))
}

// ── different client keys are isolated ──
__resetForTests()
{
  const limit = 2
  const keyA = 'client-a'
  const keyB = 'client-b'
  checkRateLimit(keyA, 60_000, limit)
  checkRateLimit(keyA, 60_000, limit)
  const aBlocked = !checkRateLimit(keyA, 60_000, limit).allowed
  const bStillAllowed = checkRateLimit(keyB, 60_000, limit).allowed
  check('Client A is blocked after hitting its own limit', aBlocked)
  check('Client B (different key) is unaffected by client A\'s limit', bStillAllowed)
}

// ── window expiry allows requests again ──
__resetForTests()
{
  const key = 'test-key-window'
  const shortWindowMs = 50
  const limit = 1
  const first = checkRateLimit(key, shortWindowMs, limit)
  const second = checkRateLimit(key, shortWindowMs, limit)
  check('First request in a fresh window is allowed', first.allowed)
  check('Second request in the same window is blocked', !second.allowed)
  await new Promise(r => setTimeout(r, shortWindowMs + 20))
  const third = checkRateLimit(key, shortWindowMs, limit)
  check('Request after the window expires is allowed again', third.allowed)
}

// ── hashClientKey never returns the raw input ──
{
  const raw = '203.0.113.42'
  const hashed = hashClientKey(raw)
  check('hashClientKey output does not contain the raw IP', !hashed.includes(raw))
  check('hashClientKey output is a short, fixed-length hex string', /^[0-9a-f]{16}$/.test(hashed), hashed)
  check('hashClientKey is deterministic for the same input', hashClientKey(raw) === hashed)
  check('hashClientKey differs for different inputs', hashClientKey('198.51.100.7') !== hashed)
}

// ── getClientIp reads x-forwarded-for, falls back safely ──
{
  const withForwarded = getClientIp({ headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' }, socket: {} })
  check('getClientIp takes the first entry of x-forwarded-for', withForwarded === '203.0.113.42', withForwarded)
  const withoutForwarded = getClientIp({ headers: {}, socket: { remoteAddress: '10.0.0.5' } })
  check('getClientIp falls back to socket.remoteAddress', withoutForwarded === '10.0.0.5', withoutForwarded)
  const withNeither = getClientIp({ headers: {}, socket: {} })
  check('getClientIp falls back to "unknown" when nothing is available', withNeither === 'unknown', withNeither)
}

summary()
