// api/_lib/durable-rate-limit.js — durable, atomic, shared rate limiter
// for PUBLIC unauthenticated Showcase endpoints (Codex fix-round: "Rate
// limiting" — api/showcase-public.js, api/create-showcase-enquiry.js).
//
// WHY THIS EXISTS: api/_lib/rate-limit.js is an in-memory Map, explicitly
// documented (see its own header) as reset on every cold start and NOT
// shared across concurrent serverless instances — a real but accepted
// limitation for api/passport.js's existing traffic, but Codex's
// fix-round for Showcase specifically requires either clearly
// re-documenting that same limitation OR a durable, shared, atomic
// replacement, using only infrastructure already provisioned (no new
// paid service, login, or environment variable — Firestore is already
// live in every environment this app runs in).
//
// HOW IT'S DURABLE AND ATOMIC: a fixed-window counter stored as a single
// Firestore document per (namespace, hashed client key), mutated only
// inside a Firestore transaction. Firestore transactions serialize
// concurrent read-modify-write attempts against the SAME document
// (optimistic concurrency + automatic retry) regardless of which
// serverless instance/region handled the request — this is the actual
// property an in-memory Map cannot offer. Firestore itself is the "durable
// shared store"; no new service is introduced.
//
// COLLECTION: `rateLimitCounters/{namespace}:{hashedKey}`. Deliberately
// separate from every user-facing collection, denied to all clients by
// this repo's own firestore.rules default-deny-all closing match (see
// bottom of firestore.rules) — Admin SDK access (this module) bypasses
// Rules entirely, same trust boundary as litterPuppyOperations/
// processedStripeEvents/litterQuotaLedger. Documents are small
// (namespace, windowStart, count, expiresAt) and self-heal every window
// for a RETURNING client (a stale document past its window is simply
// overwritten on that client's next request, never read as still-valid)
// — this limiter's own CORRECTNESS never depends on anything being
// deleted. But a one-time-only visitor (the overwhelmingly common case
// for an anonymous public Showcase viewer — a distinct hashed IP that
// never comes back) leaves its single small document behind forever
// with nothing to ever overwrite or delete it — left unmanaged, this
// collection grows by roughly one document per distinct visitor-IP
// (× however many of the 3 namespaces they touched) for the lifetime of
// the product, unbounded.
//
// REQUIRED BEFORE PRODUCTION (not yet done — no deploy has happened in
// this fix-round): configure a Firestore TTL policy on this exact
// collection/field pair, via either the Firebase Console
// (Firestore Database → TTL) or the gcloud CLI:
//   gcloud firestore fields ttls update expiresAt \
//     --collection-group=rateLimitCounters \
//     --enable-ttl --project=<PROJECT_ID>
// The `expiresAt` field already written on every document (set to
// `now + windowMs * 2` at creation — i.e. two full rate-limit windows
// past creation, comfortably after the document could still be "current")
// is exactly the field this policy should target; no code or schema
// change is needed to enable it, only the one-time policy configuration
// itself (Firestore's own TTL deletion is a background process, typically
// within ~24h of expiry, not instant — acceptable here since it is a
// storage-hygiene cleanup, not a correctness mechanism). Until this
// policy is configured, the collection will grow unbounded in production
// — this is a deployment prerequisite, not an optional optimization.
//
// KNOWN LIMITATION (verified directly against the local Firestore
// emulator, not confirmed against live production Firestore in this
// environment): contention against an ALREADY-EXISTING counter document
// serializes correctly (confirmed via direct concurrent-burst testing —
// exactly maxRequests allowed, the rest denied). A burst of truly
// simultaneous FIRST-EVER requests for a brand-new key — every one
// racing the SAME initial "no document yet, create it" transaction
// branch before any of them commits — was observed, in the local
// emulator specifically, to under-serialize: multiple concurrent
// "creator" transactions each read the same nonexistent-document state
// and committed independently rather than one winning and the rest
// conflicting/retrying. Real Firestore's documented transaction
// semantics (reads establish a precondition on commit, including a
// precondition of "did not exist") should prevent this on production,
// but that could not be verified here without a live project. Until
// re-verified against production, treat a brand-new key's very first
// concurrent burst as the one scenario this limiter's atomicity is NOT
// fully proven for — flagged for Codex re-review, not silently masked.
//
// FAIL-OPEN ON INFRASTRUCTURE ERROR: if the Firestore transaction itself
// throws (e.g. a transient outage), the request is allowed through rather
// than made to 500 — an unavailable rate limiter must never become an
// unavailable product. This mirrors the in-memory limiter's own
// unconditional-allow-on-first-request behavior in spirit: the limiter is
// a deterrent layered on top of a working product, not a dependency the
// product's availability should be gated on.

import { FieldValue } from 'firebase-admin/firestore'

export const DURABLE_RATE_LIMIT_WINDOW_MS = Number(process.env.SHOWCASE_RATE_LIMIT_WINDOW_MS) || 60_000
export const DURABLE_RATE_LIMIT_MAX_REQUESTS = Number(process.env.SHOWCASE_RATE_LIMIT_MAX_REQUESTS) || 30

const COLLECTION = 'rateLimitCounters'

// Returns { allowed, retryAfterSeconds }. `namespace` scopes independent
// limiter budgets (e.g. 'showcase-public', 'showcase-enquiry') sharing the
// same collection without sharing counts — mirrors the existing
// in-memory limiter's own 'showcase:' key-prefix convention.
export async function checkDurableRateLimit(
  db,
  namespace,
  hashedKey,
  windowMs = DURABLE_RATE_LIMIT_WINDOW_MS,
  maxRequests = DURABLE_RATE_LIMIT_MAX_REQUESTS
) {
  const docId = `${namespace}:${hashedKey}`
  const ref = db.collection(COLLECTION).doc(docId)

  try {
    return await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      const now = Date.now()
      const data = snap.exists ? snap.data() : null

      const windowExpired = !data || typeof data.windowStart !== 'number' || (now - data.windowStart) >= windowMs

      if (windowExpired) {
        tx.set(ref, {
          windowStart: now,
          count: 1,
          expiresAt: new Date(now + windowMs * 2),
        })
        return { allowed: true }
      }

      const currentCount = typeof data.count === 'number' ? data.count : 0
      if (currentCount >= maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - data.windowStart)) / 1000))
        return { allowed: false, retryAfterSeconds }
      }

      tx.update(ref, { count: FieldValue.increment(1) })
      return { allowed: true }
    })
  } catch {
    // Fail-open — see header comment. A rate-limiter outage must never
    // take the public Showcase page down with it.
    return { allowed: true }
  }
}

// Test-only escape hatch — deletes a specific counter doc so assertions
// aren't order-dependent on prior calls in the same emulator run.
export async function __resetDurableRateLimitForTests(db, namespace, hashedKey) {
  await db.collection(COLLECTION).doc(`${namespace}:${hashedKey}`).delete()
}
