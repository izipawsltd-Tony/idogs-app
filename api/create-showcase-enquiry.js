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
// visible puppyId, all return the SAME generic 404 the read endpoint
// uses — never a distinguishing signal.
//
// POST /api/create-showcase-enquiry
// Body: { token, puppyId?, name, email?, phone?, message, consent, website? }
//   (`website` is an intentionally-undocumented honeypot field — see
//   api/_lib/enquiry-schema.js)
// Returns: { success: true } | { error } | 404 | 429 | 400

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { checkRateLimit, getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'
import { sanitizeEnquiryInput, EnquiryValidationError } from './_lib/enquiry-schema.js'

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
  const clientKey = hashClientKey(`enquiry:${getClientIp(req)}`)
  const rateLimitResult = checkRateLimit(clientKey, ENQUIRY_RATE_LIMIT_WINDOW_MS, ENQUIRY_RATE_LIMIT_MAX_REQUESTS)
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

    // A supplied puppyId must be a CURRENTLY VISIBLE member of this
    // exact Showcase — never trusted merely because it looks like a
    // plausible Dog id. Same fail-closed, generic-404 posture as an
    // invalid token, since this is a trust-boundary mismatch, not an
    // ordinary user-correctable form error.
    if (sanitized.puppyId && showcase.puppies?.[sanitized.puppyId]?.visible !== true) {
      return res.status(404).json({ error: 'Not found' })
    }

    await db.collection('showcaseEnquiries').add({
      tenantId: showcase.tenantId,
      litterId,
      puppyId: sanitized.puppyId,
      name: sanitized.name,
      email: sanitized.email,
      phone: sanitized.phone,
      message: sanitized.message,
      createdAt: FieldValue.serverTimestamp(),
    })

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('create-showcase-enquiry error:', { code: 'ENQUIRY_SUBMIT_FAILED' })
    return res.status(500).json({ error: 'Internal error' })
  }
}
