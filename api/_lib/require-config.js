// api/_lib/require-config.js — fail-closed environment validation for
// server endpoints that must never silently fall back to, or be
// misconfigured into, operating against a Firebase project / Storage
// bucket / public origin that doesn't match the deployment's OWN
// identity (the bounded staging-isolation safety patch).
//
// Round 18 removed every hardcoded PRODUCTION fallback
// (`FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app'`,
// `APP_URL || 'https://idogs.com.au'`). Round 19 (Codex High blockers)
// goes further: it's not enough for these values to be PRESENT — they
// must also be the value that actually BELONGS to the Firebase project
// this deployment is running against, per an explicit, hardcoded
// project-identity policy below. A staging deployment with
// FIREBASE_PROJECT_ID=idogs-app-staging but a copy/pasted PRODUCTION
// bucket name or origin must fail exactly as hard as a missing one.
//
// There is no fallback value anywhere in this module. Callers must
// check for null and return a sanitized 5xx response BEFORE touching
// Firebase/Storage or making any outbound request; see
// get-signed-url.js, upload-document.js, upload.js, create-checkout.js
// and send-reminders.js.

function isCleanString(raw) {
  return typeof raw === 'string' && raw.length > 0 && raw.trim() === raw
}

// Firebase/GCP project IDs: 6-30 characters, lowercase letters, digits,
// hyphens; must start with a letter, must not end with a hyphen. Both
// 'idogs-app' and 'idogs-app-staging' satisfy this.
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

// ── Storage bucket ──────────────────────────────────────────────────

// A Storage bucket name is a DNS-safe label string — reject anything
// with consecutive dots, invalid characters, or excessive length before
// ever comparing it to the expected value, so a malformed value fails
// for an explicit, specific reason rather than just "didn't match".
const BUCKET_LABEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]$/
const MAX_BUCKET_LENGTH = 222

// Requires BOTH FIREBASE_PROJECT_ID and FIREBASE_STORAGE_BUCKET to be
// explicitly present, well-formed, AND for the bucket to be EXACTLY the
// one that belongs to that project — never derived/defaulted, never
// accepted just because it's "a" well-formed bucket name.
//
// For the current Firebase naming model this is exactly
// `${FIREBASE_PROJECT_ID}.firebasestorage.app`. Legacy
// `<project>.appspot.com` support is deliberately NOT accepted — no
// tracked configuration in this repo evidences it being required (see
// the round-19 report), and accepting it would widen the set of values
// this validator treats as correct without that being established. If
// it turns out to be genuinely needed, that is a configuration decision
// to make explicitly, not something this validator should assume.
export function requireStorageBucket() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const bucket = process.env.FIREBASE_STORAGE_BUCKET

  if (!isCleanString(projectId)) return null
  if (!PROJECT_ID_PATTERN.test(projectId)) return null

  if (!isCleanString(bucket)) return null
  if (bucket.length > MAX_BUCKET_LENGTH) return null
  if (bucket.includes('..')) return null
  if (!BUCKET_LABEL_PATTERN.test(bucket)) return null

  const expected = `${projectId}.firebasestorage.app`
  if (bucket !== expected) return null

  return bucket
}

// ── App origin (APP_URL) ────────────────────────────────────────────

// Explicit, fail-closed project-to-host policy — the only two Firebase
// projects that exist for this app (see CLAUDE.md). A FIREBASE_PROJECT_ID
// that is neither of these has no allowlist to satisfy and is rejected
// outright, rather than falling through to some default set of hosts.
const STAGING_PROJECT_ID = 'idogs-app-staging'
const PRODUCTION_PROJECT_ID = 'idogs-app'

// Tracked-config-derived canonical production hostnames (CLAUDE.md:
// "Production: https://idogs.com.au" / "Vercel alias:
// https://idogs-app.vercel.app"). No other production hostname is
// documented anywhere in this repo.
const PRODUCTION_ALLOWED_HOSTS = new Set([
  'idogs.com.au',
  'idogs-app.vercel.app',
])

// The dedicated Vercel staging project (izipawsltd-tonys-projects/
// idogs-app-staging, project prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o — created
// and linked to this worktree earlier this session) has not yet had any
// deployment, so its actual assigned stable hostname cannot be read from
// any tracked file or API response — Vercel assigns
// `<project-name>.vercel.app` by default, but that is a platform
// convention, not a confirmed fact about THIS project, and this patch
// performs no deploy to confirm it. `idogs-app-staging.vercel.app` is
// accepted on that convention basis. Vercel's per-deployment Preview
// hostnames (`idogs-app-staging-<hash>-izipawsltd-tonys-projects.vercel.app`)
// are deliberately NOT accepted — the exact hash-generation shape isn't
// something this patch can verify without deployment access, and
// guessing a pattern here would risk exactly the "accept an arbitrary
// host merely because it looks plausible" failure mode this validator
// exists to prevent. See the round-19 report's Limitations section.
const STAGING_ALLOWED_HOSTS = new Set([
  'idogs-app-staging.vercel.app',
])

function isLoopbackPrivateOrLinkLocalHost(hostname) {
  if (hostname === 'localhost') return true

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some(o => o > 255)) return true // malformed IPv4-shaped value — reject, don't guess
    const [a, b] = octets
    if (a === 127) return true // loopback 127.0.0.0/8
    if (a === 10) return true // private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // private 172.16.0.0/12
    if (a === 192 && b === 168) return true // private 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local 169.254.0.0/16
    if (a === 0) return true // non-routable
    return false
  }

  // IPv6 — new URL() keeps the host bracketed, e.g. "[::1]".
  const ipv6 = hostname.replace(/^\[|\]$/g, '')
  if (ipv6 === '::1' || ipv6 === '::') return true
  if (ipv6.startsWith('fe80:')) return true // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(ipv6)) return true // unique-local fc00::/7

  return false
}

// Requires FIREBASE_PROJECT_ID to be one of the two known projects, and
// APP_URL to be an absolute https:// origin — no credentials, no path,
// no query, no fragment, no explicit port, no loopback/private/link-
// local host, no bare "localhost" — whose HOST is on that project's own
// explicit allowlist. Returns a normalized `https://{host}` origin (no
// trailing slash, no port) or null. Never reads/trusts a request's Host
// header — environment identity comes ONLY from FIREBASE_PROJECT_ID +
// APP_URL, both server-side configuration.
export function requireAppUrl() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const raw = process.env.APP_URL
  if (!isCleanString(raw)) return null

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  if (parsed.port) return null
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null
  if (parsed.search || parsed.hash) return null

  const hostname = parsed.hostname.toLowerCase()
  if (isLoopbackPrivateOrLinkLocalHost(hostname)) return null

  let allowed
  if (projectId === STAGING_PROJECT_ID) allowed = STAGING_ALLOWED_HOSTS
  else if (projectId === PRODUCTION_PROJECT_ID) allowed = PRODUCTION_ALLOWED_HOSTS
  else return null // unknown/missing project id — no allowlist to satisfy

  if (!allowed.has(hostname)) return null

  return `https://${hostname}`
}

// Fixed, allowlisted operation + code pairs only — never the raw env
// value, never err.message/err.stack. Mirrors the client-side
// safeReadFirestoreErrorCode() contract (src/lib/db.ts) at the server
// boundary: what failed and why, nothing that could leak configuration
// detail into logs.
export function logConfigError(operation, code) {
  console.error(`${operation}: configuration error`, { code })
}
