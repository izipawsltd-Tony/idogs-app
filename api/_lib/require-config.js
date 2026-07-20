// api/_lib/require-config.js — fail-closed environment validation for
// server endpoints that must never silently fall back to a hardcoded
// PRODUCTION resource (the Firebase Storage bucket, the app's own public
// origin) when their own environment is missing or malformed.
//
// Bounded staging-isolation safety patch: the environment inventory
// found `process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app'`
// and `process.env.APP_URL || 'https://idogs.com.au'` fallbacks across
// several endpoints — a Preview/staging deployment missing either var
// would silently operate against PRODUCTION's storage bucket or
// redirect/call the LIVE production domain, without any error. These
// validators replace every one of those fallbacks: each reads exactly
// one env var and returns the value ONLY if it passes a strict shape
// check, or null if missing/blank/malformed — there is no fallback
// value anywhere in this module. Callers must check for null and return
// a sanitized 5xx response BEFORE touching Firebase/Storage or making
// any outbound request; see get-signed-url.js, upload-document.js,
// upload.js, create-checkout.js and send-reminders.js.

// A Firebase Storage bucket name is a DNS-safe string — real Firebase
// projects always produce either the legacy `<project>.appspot.com` or
// the current `<project>.firebasestorage.app` shape. This pattern is
// deliberately a little more permissive than that exact suffix (so a
// differently-named/custom bucket isn't blocked) while still rejecting
// empty, whitespace-only, or structurally invalid values.
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]$/i

// Reads FIREBASE_STORAGE_BUCKET. Returns the trimmed value if it's a
// well-formed bucket name, otherwise null — NEVER a hardcoded project
// name. Leading/trailing whitespace is treated as malformed (rejected,
// not silently trimmed-and-accepted) — a padded value is exactly the
// kind of copy/paste mistake this check exists to catch, not repair.
export function requireStorageBucket() {
  const raw = process.env.FIREBASE_STORAGE_BUCKET
  if (typeof raw !== 'string') return null
  if (raw.trim() !== raw) return null
  if (!raw) return null
  if (!BUCKET_NAME_PATTERN.test(raw)) return null
  return raw
}

// APP_URL is the app's own public origin — used to build Stripe
// redirect URLs and the reminders cron's server-to-server call back into
// its own /api/send-email. A missing or malformed value must never fall
// back to the production domain: a staging/Preview deployment with no
// APP_URL configured would otherwise redirect real users to, or place
// outbound calls against, the LIVE production site.
//
// Only http://localhost(:port) is accepted as an exception, and only
// because this repo's own local test/dev tooling already assumes it's
// reachable with zero further configuration — it is never a valid
// target for a Preview/Production deployment (which always terminates
// TLS), so this does not weaken the production-facing guarantee above.
// VERCEL_URL is deliberately NOT consulted here — see the module-level
// comment in create-checkout.js/send-reminders.js for why (its
// trust/security implications for a preview-protected redirect target
// haven't been validated; APP_URL is configured explicitly per project
// instead).
const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/localhost(:\d+)?$/i

export function requireAppUrl() {
  const raw = process.env.APP_URL
  if (typeof raw !== 'string') return null
  if (raw.trim() !== raw) return null
  if (!raw) return null
  if (LOCALHOST_ORIGIN_PATTERN.test(raw)) return raw
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  // APP_URL is an ORIGIN, not a full URL — callers append their own
  // path. A trailing slash is tolerated (stripped) as a harmless typo;
  // anything else in the path, or a query/hash, is rejected outright.
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null
  if (parsed.search || parsed.hash) return null
  return raw.replace(/\/$/, '')
}

// Fixed, allowlisted operation + code pairs only — never the raw env
// value, never err.message/err.stack. Mirrors the client-side
// safeReadFirestoreErrorCode() contract (src/lib/db.ts) at the server
// boundary: what failed and why, nothing that could leak configuration
// detail into logs.
export function logConfigError(operation, code) {
  console.error(`${operation}: configuration error`, { code })
}
