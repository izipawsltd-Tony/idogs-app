// api/create-showcase-enquiry.js — public, unauthenticated "contact the
// breeder" submission from a live Litter Showcase page (Slice 2).
//
// Same trust posture as api/showcase-public.js (the read side this
// endpoint is the write counterpart to): Admin SDK, rate-limited before
// any lookup, and tenantId/litterId are NEVER accepted from the client —
// they are resolved server-side from the caller-supplied share TOKEN,
// the exact same hash-lookup + isShareLive() check the public read
// endpoint uses. This means an enquiry can only ever be attributed to a
// litter the caller actually holds a live, valid link for — never an
// arbitrary litterId/tenantId a malicious caller might supply directly,
// which is what "tenant-scope enquiries and retain litter/puppy
// attribution" actually requires at the trust-boundary level (not just
// "the field exists on the document").
//
// A wrong/disabled/expired/revoked token, and an invalid/not-currently-
// visible puppyRef, all return the SAME generic 404 the read endpoint
// uses — never a distinguishing signal.
//
// Codex fix-round ("Public identifiers"): the client never has, and
// never sends, a real Firestore dogId — it sends the SAME opaque
// `puppyRef` api/showcase-public.js's own public projection handed it
// (see opaquePuppyRef() in api/_lib/showcase-media-access.js). This
// endpoint resolves it back to a real dogId itself, by recomputing that
// same hash for every puppy already known to be a currently-visible
// member of the TOKEN-RESOLVED Showcase, and matching against those —
// never by looking the ref up in some separate global table. This is
// exactly why the ref carries no authority of its own: a fabricated or
// replayed ref still has to collide with one of THIS showcase's own
// visible puppies to resolve to anything, and reaching "this showcase"
// at all already required its own valid, live share token. The resolved
// real dogId is stored on the Firestore showcaseEnquiries document
// (authenticated, tenant-scoped, breeder-only read — see firestore.rules
// — exactly what LittersPage.tsx's enquiry list already expects to match
// against its own puppyDogs) — only the PUBLIC-facing wire format uses
// the opaque form.
//
// POST /api/create-showcase-enquiry
// Body: { token, puppyRef?, name, email?, phone?, message, consent, website? }
//   (`website` is an intentionally-undocumented honeypot field — see
//   api/_lib/enquiry-schema.js)
// Returns: { success: true, notified: boolean } | { error } | 404 | 429 | 400
//
// Tony live-staging finding (round 2 — "enquiry destination unclear"):
// a PREVIOUS round already reworded the public success copy once, to
// stop literally claiming "an email was sent" — but the enquiry was
// (and still is, structurally) ONLY EVER PERSISTED here; nothing was
// ever sent to the breeder, so even the reworded "has received your
// enquiry" copy overstated what actually happened. This round adds a
// REAL best-effort email notification to the breeder — via the SAME
// Resend provider/domain/sender this codebase already uses everywhere
// else (api/send-email.js, api/survey.js) — and reports the true
// outcome back to the caller as `notified`, so the frontend can show one
// of three honest states instead of one optimistic one. See
// api/_lib/showcase-notification.js's sendShowcaseEnquiryNotification()
// for the graceful-degradation contract this depends on.
//
// SECURITY: the recipient is ALWAYS resolved server-side from the
// token-matched Showcase's own tenantId, via Firebase Auth (the
// authoritative source of an account's real login email — this app
// never duplicates email into the Firestore user profile). The request
// body has no field this endpoint ever reads as a recipient — only the
// ENQUIRER's own contact email (`sanitized.email`), which is stored for
// the breeder to reply to and is never used as a send-to address.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'
import { sanitizeEnquiryInput, EnquiryValidationError } from './_lib/enquiry-schema.js'
import { resolveVisiblePuppyByRef } from './_lib/showcase-media-access.js'
import { sendShowcaseEnquiryNotification } from './_lib/showcase-notification.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const db = getFirestore()

// Deliberately much stricter than api/showcase-public.js's read-side
// default (30/60s) — a write endpoint that ends with an email/phone
// number landing in a breeder's dashboard is a meaningfully higher-value
// spam/abuse target than a passive page view.
const ENQUIRY_RATE_LIMIT_WINDOW_MS = Number(process.env.ENQUIRY_RATE_LIMIT_WINDOW_MS) || 10 * 60_000
const ENQUIRY_RATE_LIMIT_MAX_REQUESTS = Number(process.env.ENQUIRY_RATE_LIMIT_MAX_REQUESTS) || 5

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit first, before any other validation or lookup — same
  // posture as every other public endpoint in this codebase. Namespaced
  // so this endpoint's (stricter) budget is never shared with, or
  // exhausted by, api/showcase-public.js's own (looser) read traffic.
  // Durable/atomic (Firestore-transaction-backed) — see
  // api/_lib/durable-rate-limit.js for why this endpoint in particular
  // needs a shared-across-instances limiter, not the in-memory one.
  const clientKey = hashClientKey(getClientIp(req))
  const rateLimitResult = await checkDurableRateLimit(
    db,
    'showcase-enquiry',
    clientKey,
    ENQUIRY_RATE_LIMIT_WINDOW_MS,
    ENQUIRY_RATE_LIMIT_MAX_REQUESTS
  )
  if (!rateLimitResult.allowed) {
    res.setHeader('Retry-After', String(rateLimitResult.retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const { token } = body
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token required' })
  }

  let sanitized
  try {
    sanitized = sanitizeEnquiryInput(body)
  } catch (err) {
    if (err instanceof EnquiryValidationError) {
      return res.status(400).json({ error: err.message })
    }
    throw err
  }

  // Honeypot tripped — pretend success, write nothing. Never
  // distinguishable from a real success on the wire.
  if (sanitized.honeypotFilled) {
    return res.status(200).json({ success: true })
  }

  try {
    const tokenHash = hashShareToken(token)
    const showcaseSnap = await db.collection('litterShowcases')
      .where('shareTokenHash', '==', tokenHash)
      .limit(1)
      .get()

    if (showcaseSnap.empty) {
      return res.status(404).json({ error: 'Not found' })
    }
    const showcaseDoc = showcaseSnap.docs[0]
    const showcase = showcaseDoc.data()

    if (!isShareLive(showcase)) {
      return res.status(404).json({ error: 'Not found' })
    }

    // Integration-hardening fix (Slice 2, commit 5/5) — same tenant-plan
    // re-check as api/showcase-public.js; see isTenantPlusEligible()'s
    // own comment. A breeder who downgraded after publishing a link must
    // not keep receiving enquiries through it either.
    const profileSnap = await db.collection('users').doc(showcase.tenantId).get()
    if (!isTenantPlusEligible(profileSnap.exists ? profileSnap.data() : null)) {
      return res.status(404).json({ error: 'Not found' })
    }

    const litterId = showcaseDoc.id

    // Tenant-chain validation (Codex fix-round) — same fail-closed check
    // api/showcase-public.js applies: a Showcase whose Litter has drifted
    // to a different tenant (data-integrity edge case, or a forged/stale
    // relationship) must not accept enquiries attributed to it either.
    const litterSnap = await db.collection('litters').doc(litterId).get()
    if (!litterSnap.exists || litterSnap.data().tenantId !== showcase.tenantId) {
      return res.status(404).json({ error: 'Not found' })
    }
    // Reused for the legacy-litterId fallback below — no extra Firestore
    // read (litterSnap was already fetched for the tenant-chain check
    // above).
    const litterPuppyIds = new Set(litterSnap.data().puppyIds || [])

    // Public identifiers: resolve the client-supplied opaque puppyRef
    // back to a real dogId. Shared with api/showcase-media.js, which
    // resolves the exact same way for the exact same reason (see
    // resolveVisiblePuppyByRef()'s own comment in api/_lib/showcase-
    // media-access.js) — same fail-closed, generic-404 posture as an
    // invalid token, since a ref that doesn't resolve is a trust-
    // boundary mismatch, not an ordinary user-correctable form error.
    let resolvedPuppyId = null
    let resolvedPuppyName = null
    if (sanitized.puppyRef) {
      const resolved = await resolveVisiblePuppyByRef(db, showcase, litterId, sanitized.puppyRef, litterPuppyIds)
      if (!resolved) {
        return res.status(404).json({ error: 'Not found' })
      }
      resolvedPuppyId = resolved.dogId
      resolvedPuppyName = resolved.dog.name || null
    }

    // Recipient resolution — ALWAYS from showcase.tenantId (already
    // proven single-sourced from the token match + tenant-chain
    // validation above), NEVER from anything in the request body. A
    // deleted/malformed Auth record must not crash the request — it
    // just means no notification can be attempted.
    let breederEmail = null
    try {
      const breederUser = await getAuth().getUser(showcase.tenantId)
      breederEmail = breederUser.email || null
    } catch {
      breederEmail = null
    }

    // ── Durability-first ordering (Codex fix-round: "email delivery and
    // Firestore persistence are not one atomic operation") ─────────────
    //
    // Email delivery through Resend and the Firestore write are two
    // INDEPENDENT operations with no shared transaction — a naive
    // "attempt the email, then write" ordering has a real data-loss
    // window: if the Resend call hangs or this function's execution is
    // cut off (a Vercel timeout, a cold-start eviction) anywhere during
    // that network call, the enquiry is NEVER written at all — a buyer's
    // message vanishes with no trace and no error either party can act
    // on. The required invariant is the reverse: the enquiry's existence
    // must never depend on the email succeeding, completing, or even
    // being attempted.
    //
    // 1. Create the enquiry FIRST, with notified:false — durable before
    //    any external network call is made at all.
    const enquiryRef = await db.collection('showcaseEnquiries').add({
      tenantId: showcase.tenantId,
      litterId,
      puppyId: resolvedPuppyId,
      name: sanitized.name,
      email: sanitized.email,
      phone: sanitized.phone,
      message: sanitized.message,
      createdAt: FieldValue.serverTimestamp(),
      notified: false,
    })
    // If the write above throws, execution jumps straight to this
    // function's own outer catch (below) — sendShowcaseEnquiryNotification
    // is never reached, so a Firestore write failure can never trigger an
    // email attempt for an enquiry that was never actually saved.

    // 2. ONLY THEN attempt the notification — a pure side effect from
    // this point on; its outcome updates the ALREADY-DURABLE document,
    // it never determines whether that document exists.
    const { notified, errorCode: notificationErrorCode } = await sendShowcaseEnquiryNotification({
      breederEmail,
      litterName: litterSnap.data().name,
      puppyName: resolvedPuppyName,
      enquirerName: sanitized.name,
      enquirerEmail: sanitized.email,
      enquirerPhone: sanitized.phone,
      message: sanitized.message,
    })

    // 3. Record the true outcome on the SAME document — never a second
    // enquiry, never a delete+recreate. If this update itself fails, the
    // enquiry (from step 1) is already safely preserved regardless; we
    // deliberately do NOT retry the email here (sendShowcaseEnquiryNotification
    // already ran exactly once above — retrying now risks a real double
    // send if Resend already accepted the original attempt) and we
    // deliberately do NOT retry the update in a loop (a stuck/failing
    // Firestore write must not turn into an unbounded retry storm on a
    // public, unauthenticated endpoint). The HTTP response below still
    // reports the CORRECT `notified` value either way — it's read from
    // this request's own in-memory result, never re-derived from a
    // document read that could itself now be stale.
    try {
      await enquiryRef.update({
        notified,
        ...(notificationErrorCode ? { notificationErrorCode } : {}),
      })
    } catch {
      console.error('create-showcase-enquiry status update:', { code: 'NOTIFICATION_STATUS_UPDATE_FAILED' })
    }

    // Fixed reason code only, for retry/admin review — never the raw
    // provider error (which can echo back the recipient address) and
    // never breederEmail/sanitized.email/sanitized.phone.
    if (notificationErrorCode) {
      console.error('create-showcase-enquiry notification:', { code: notificationErrorCode })
    }

    return res.status(200).json({ success: true, notified })
  } catch (err) {
    console.error('create-showcase-enquiry error:', { code: 'ENQUIRY_SUBMIT_FAILED' })
    return res.status(500).json({ error: 'Internal error' })
  }
}
