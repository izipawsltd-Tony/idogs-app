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
// project-identity policy below.

function isCleanString(raw) {
  return typeof raw === 'string' && raw.length > 0 && raw.trim() === raw
}

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

// ── Storage bucket ──────────────────────────────────────────────────
const BUCKET_LABEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]$/
const MAX_BUCKET_LENGTH = 222

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
const STAGING_PROJECT_ID = 'idogs-app-staging'
const PRODUCTION_PROJECT_ID = 'idogs-app'
const PRODUCTION_VERCEL_PROJECT_ID = 'prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo'
const PRODUCTION_PREVIEW_HOST_PATTERN = /^idogs-[a-z0-9-]+-izipawsltd-tonys-projects\.vercel\.app$/

const PRODUCTION_ALLOWED_HOSTS = new Set([
  'idogs.com.au',
  'idogs-app.vercel.app',
])

const STAGING_ALLOWED_HOSTS = new Set([
  'idogs-app-staging.vercel.app',
])

function isLoopbackPrivateOrLinkLocalHost(hostname) {
  if (hostname === 'localhost') return true

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some(o => o > 255)) return true
    const [a, b] = octets
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    return false
  }

  const ipv6 = hostname.replace(/^\[|\]$/g, '')
  if (ipv6 === '::1' || ipv6 === '::') return true
  if (ipv6.startsWith('fe80:')) return true
  if (/^f[cd][0-9a-f]{2}:/.test(ipv6)) return true

  return false
}

// Vercel exposes VERCEL_ENV, VERCEL_URL and VERCEL_PROJECT_ID as
// system environment variables. This fallback is intentionally narrow:
// it exists only for Preview deployments of the known production Vercel
// project, using the generated deployment hostname for that exact team.
// It is never used when APP_URL is present, never runs in production,
// never runs for staging, and never trusts the request Host header.
function requireVerifiedProductionPreviewOrigin(projectId) {
  if (projectId !== PRODUCTION_PROJECT_ID) return null
  if (process.env.VERCEL_ENV !== 'preview') return null
  if (process.env.VERCEL_PROJECT_ID !== PRODUCTION_VERCEL_PROJECT_ID) return null

  const rawHost = process.env.VERCEL_URL
  if (!isCleanString(rawHost)) return null
  if (rawHost.includes('://') || rawHost.includes('/') || rawHost.includes('?') || rawHost.includes('#') || rawHost.includes(':')) return null

  const hostname = rawHost.toLowerCase()
  if (!PRODUCTION_PREVIEW_HOST_PATTERN.test(hostname)) return null
  if (isLoopbackPrivateOrLinkLocalHost(hostname)) return null

  return `https://${hostname}`
}

// Requires FIREBASE_PROJECT_ID to be one of the two known projects, and
// APP_URL to be an absolute https:// origin whose host is on that
// project's explicit allowlist. If APP_URL is ABSENT, a production
// Vercel Preview may instead use the generated deployment origin, but
// only after the strict identity checks above. An invalid PRESENT
// APP_URL never falls back — it fails closed.
export function requireAppUrl() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const raw = process.env.APP_URL

  if (raw === undefined) {
    return requireVerifiedProductionPreviewOrigin(projectId)
  }
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
  else return null

  if (!allowed.has(hostname)) return null

  return `https://${hostname}`
}

export function logConfigError(operation, code) {
  console.error(`${operation}: configuration error`, { code })
}
