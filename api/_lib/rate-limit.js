// api/_lib/rate-limit.js — shared in-memory rate limiter for public,
// unauthenticated API routes (ADR-002 Phase C1, currently used by
// api/passport.js).
//
// SERVERLESS LIMITATION (documented, not claimed to be production-grade):
// this project has no durable, shared rate-limit storage (no Vercel KV,
// Redis, Upstash, or equivalent — confirmed absent from package.json,
// vercel.json, and the api/ directory during this phase's audit).
// Vercel serverless functions on the Node.js runtime may run as
// multiple concurrent instances, each with its own separate memory —
// this in-memory Map is only shared across invocations that happen to
// land on the SAME warm instance, and is reset entirely on cold start.
// Under real production traffic spread across many instances/regions,
// the effective limit is only a soft, best-effort deterrent — a
// determined client distributed across enough concurrent connections
// could exceed the nominal threshold. This is an accepted, documented
// tradeoff for a Preview-stage feature, not a claim of a hard guarantee.
// PRODUCTION RECOMMENDATION: replace with a durable, shared limiter
// (e.g. Vercel KV / Upstash Redis via @upstash/ratelimit, or Vercel's
// own Edge Config + Edge Middleware) before relying on this for real
// abuse protection at scale — flagged separately, not implemented here
// since it requires a new service account (needs Tony approval).
//
// Client key: derived from the request's IP (privacy-safe — never the
// raw IP is stored or logged; only a truncated SHA-256 hash is kept in
// memory and would appear in any diagnostic output).

import { createHash } from 'crypto'

export const RATE_LIMIT_WINDOW_MS = Number(process.env.PASSPORT_RATE_LIMIT_WINDOW_MS) || 60_000
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.PASSPORT_RATE_LIMIT_MAX_REQUESTS) || 30

// Map<hashedKey, number[]> — timestamps of requests within the current window.
const requestLog = new Map()

export function hashClientKey(rawKey) {
  return createHash('sha256').update(String(rawKey)).digest('hex').slice(0, 16)
}

// Extracts a best-effort client identifier from the request, preferring
// the first (client-facing) entry of x-forwarded-for, which is what
// Vercel populates for serverless functions sitting behind its proxy.
// Never returns/logs the raw value — callers should hash it immediately
// via hashClientKey() before using it as a map key or in any log line.
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

// Fixed-window limiter. Returns { allowed, retryAfterSeconds }. Applied
// identically regardless of what the caller is about to look up —
// callers must run this BEFORE any resource-specific logic, so a 429
// never differs in timing/shape based on whether the requested resource
// exists (see api/passport.js).
export function checkRateLimit(key, windowMs = RATE_LIMIT_WINDOW_MS, maxRequests = RATE_LIMIT_MAX_REQUESTS) {
  const now = Date.now()
  const timestamps = (requestLog.get(key) || []).filter(t => now - t < windowMs)

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0]
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldestInWindow)) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  timestamps.push(now)
  requestLog.set(key, timestamps)
  return { allowed: true }
}

// Test-only escape hatch — clears all in-memory state between test runs
// so assertions aren't order-dependent on prior calls in the same process.
export function __resetForTests() {
  requestLog.clear()
}
