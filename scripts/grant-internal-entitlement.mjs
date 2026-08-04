/**
 * grant-internal-entitlement.mjs
 * Grants (or revokes) an internal Super Admin Plus-plan entitlement on a
 * verified user's own users/{uid} profile — api/_lib/entitlements.js's
 * computeEffectivePlan() treats a valid, non-expired
 * internalEntitlement.granted:true the same as a real paid Plus
 * subscription, without ever creating a fake Stripe customer/subscription.
 *
 * This is deliberately a local, Admin-SDK-only script — NOT an HTTP API
 * endpoint. There is no client-reachable path to grant this entitlement at
 * all (defense in depth on top of firestore.rules' userBillingFields()
 * protection, which blocks a direct client Firestore write to this field
 * even if one were attempted).
 *
 * The email you pass is resolved to a Firebase Auth UID via
 * admin.auth().getUserByEmail() at grant time — the write itself always
 * targets users/{uid}, never anything keyed by email. This is what makes
 * the grant "scoped to the verified UID, never email alone at request
 * time": resolution happens once, here, using Firebase Auth as the source
 * of truth, by an operator holding real Admin SDK service-account
 * credentials — never re-derived from a client-supplied value at request
 * time by any server endpoint.
 *
 * Usage:
 *   node scripts/grant-internal-entitlement.mjs \
 *     --project idogs-app-staging \
 *     --sa-path "C:\path\to\idogs-app-staging-service-account.json" \
 *     --email trunghieungo@gmail.com \
 *     --reason "Internal Super Admin — full breeder/Plus access without Stripe" \
 *     --granted-by izipawsltd@gmail.com \
 *     [--expires 2027-01-01T00:00:00Z]
 *     # dry-run by default — prints what WOULD be written, no Firestore write
 *
 *   ...same flags, plus --execute   # actually writes to Firestore
 *
 *   # Revoke (keeps the field for audit history, sets granted:false):
 *   node scripts/grant-internal-entitlement.mjs \
 *     --project idogs-app-staging --sa-path "..." \
 *     --email trunghieungo@gmail.com --revoke \
 *     --granted-by izipawsltd@gmail.com --execute
 *
 * SAFETY RULES:
 *   - Hard project-ID guard immediately after loading credentials — the
 *     loaded service-account JSON's project_id MUST match --project
 *     exactly, or the script refuses to run. Prevents a copy-paste mistake
 *     from granting entitlement (or worse, revoking it) on the wrong
 *     project.
 *   - ALL input validation — including --expires — happens before any
 *     Firebase initialization or file read. An invalid/past --expires
 *     throws immediately, before the service-account JSON is even read.
 *   - Dry-run by default. --execute is required to write anything.
 *   - Never touches plan/stripeCustomerId/stripeSubscriptionId/any other
 *     billing field — this script ONLY ever reads/writes
 *     internalEntitlement, via a merge write, so it can never clobber a
 *     real subscription's state.
 *
 * Pure argument-parsing/validation (parseArgs, parseAndValidateExpiry,
 * validateArgs) are exported so they can be unit-tested directly, without
 * ever touching the filesystem or Firebase — see
 * scripts/test-internal-entitlement.mjs. Everything that actually reads a
 * file or talks to Firebase lives in main(), which only runs when this
 * file is executed directly (see the isMainModule guard at the bottom),
 * never merely on import.
 */

import { readFileSync } from 'fs'
import { pathToFileURL } from 'node:url'

export function parseArgs(argv) {
  const args = { execute: false, revoke: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--execute') { args.execute = true; continue }
    if (arg === '--revoke') { args.revoke = true; continue }
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      args[key] = argv[i + 1]
      i++
    }
  }
  return args
}

// Fail-closed, mirroring api/_lib/entitlements.js's hasValidInternalEntitlement()
// exactly: an omitted --expires means "no expiry" (a permanent grant, valid).
// Anything PROVIDED must be a real, parseable date/time string, normalized
// to a canonical UTC ISO string via new Date(value).toISOString() — never
// stored as whatever raw text the operator typed (a date-only string, a
// non-UTC offset, etc. all normalize to the exact same UTC instant this
// way). A new grant additionally requires the expiry to be strictly in the
// future — a --expires that's already in the past would silently create an
// entitlement that resolves to 'free' the instant it's written, which is
// never the operator's intent (they'd use --revoke for that instead).
// Throws (never returns a fallback) on anything invalid — this is called
// BEFORE any Firebase initialization or file read (see main() below), so
// an invalid --expires stops the script before it ever touches a real
// credential or reads any user profile.
export function parseAndValidateExpiry(rawExpires, { requireFuture = true, now = new Date() } = {}) {
  if (rawExpires === undefined) return null
  if (typeof rawExpires !== 'string' || rawExpires.trim() === '') {
    throw new Error(`--expires must be a valid ISO date/time string, got '${rawExpires}'`)
  }
  const parsedMs = new Date(rawExpires).getTime()
  if (Number.isNaN(parsedMs)) {
    throw new Error(`--expires must be a valid ISO date/time string, got '${rawExpires}'`)
  }
  if (requireFuture && parsedMs <= now.getTime()) {
    throw new Error(`--expires must be in the future for a new grant, got '${rawExpires}' (resolves to ${new Date(parsedMs).toISOString()})`)
  }
  return new Date(parsedMs).toISOString()
}

// All pure input validation in one place — throws with an actionable
// message on the first problem found, before args.project/saPath are ever
// used to touch the filesystem or Firebase. Returns the normalized
// expiresAt (or null) alongside the parsed args so callers never
// re-derive it.
export function validateArgs(args, { now = new Date() } = {}) {
  if (!args.project || !['idogs-app', 'idogs-app-staging'].includes(args.project)) {
    throw new Error("--project must be exactly 'idogs-app' or 'idogs-app-staging'")
  }
  if (!args.saPath) {
    throw new Error('--sa-path <path to service account JSON> is required')
  }
  if (!args.email) {
    throw new Error('--email <verified account email> is required')
  }
  if (!args.grantedBy) {
    throw new Error('--granted-by <who is running this grant> is required')
  }
  if (!args.revoke && !args.reason) {
    throw new Error('--reason <why this account needs internal entitlement> is required for a grant (not needed for --revoke)')
  }
  // A revoke never sets/normalizes expiresAt from --expires — the revoke
  // path in main() only ever writes granted:false/revokedAt/revokedBy onto
  // the existing entitlement object.
  const normalizedExpiresAt = args.revoke ? null : parseAndValidateExpiry(args.expires, { requireFuture: true, now })
  return { ...args, normalizedExpiresAt }
}

// Pure — builds the exact object that would be written, given an already-
// resolved uid/time/existing-entitlement. No Firebase/filesystem access,
// so this is directly unit-testable.
export function buildEntitlementPayload(validatedArgs, { nowIso, existingEntitlement }) {
  if (validatedArgs.revoke) {
    return {
      ...(existingEntitlement || {}),
      granted: false,
      revokedAt: nowIso,
      revokedBy: validatedArgs.grantedBy,
    }
  }
  return {
    granted: true,
    grantedAt: nowIso,
    grantedBy: validatedArgs.grantedBy,
    reason: validatedArgs.reason,
    expiresAt: validatedArgs.normalizedExpiresAt,
  }
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2))
  const args = validateArgs(rawArgs) // throws before any Firebase/file access — see validateArgs' own comment
  const DRY_RUN = !args.execute

  // ── HARD GUARD — DO NOT REMOVE ─────────────────────────────────────────
  // The loaded service account MUST match the project you explicitly
  // named, or this refuses to run. This is the only thing preventing a
  // copy-paste mistake (wrong --sa-path) from silently granting/revoking
  // entitlement against the wrong Firebase project.
  const saJson = JSON.parse(readFileSync(args.saPath, 'utf8'))
  if (saJson.project_id !== args.project) {
    throw new Error(`Service account project_id ('${saJson.project_id}') does not match --project ('${args.project}') — refusing to run.`)
  }
  // ── END HARD GUARD ──────────────────────────────────────────────────────

  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const { getFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ credential: cert(saJson) })
  const auth = getAuth(app)
  const db = getFirestore(app)

  console.log('')
  console.log('=================================================================')
  console.log(`  Internal entitlement ${args.revoke ? 'REVOKE' : 'GRANT'} — project: ${args.project}`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : '*** EXECUTE — writing to Firestore ***'}`)
  console.log('=================================================================')
  console.log('')

  // Resolve email -> UID via Firebase Auth (source of truth) — the write
  // below is keyed exclusively by this resolved UID, never by email.
  const userRecord = await auth.getUserByEmail(args.email)
  const uid = userRecord.uid
  console.log(`Resolved ${args.email} -> uid ${uid}`)

  const nowIso = new Date().toISOString()
  const userRef = db.collection('users').doc(uid)
  const existingSnap = await userRef.get()
  if (!existingSnap.exists) {
    throw new Error(`users/${uid} does not exist — refusing to create a profile document from this script. The account must already have a normal profile.`)
  }

  const internalEntitlement = buildEntitlementPayload(args, {
    nowIso,
    existingEntitlement: existingSnap.data().internalEntitlement || null,
  })

  console.log('')
  console.log('Would write users/' + uid + '.internalEntitlement =')
  console.log(JSON.stringify(internalEntitlement, null, 2))
  console.log('')

  if (DRY_RUN) {
    console.log('Dry-run only — no write performed. Re-run with --execute to apply.')
    return
  }

  await userRef.set({ internalEntitlement }, { merge: true })
  console.log(`Written. ${args.revoke ? 'Revoked' : 'Granted'} internal entitlement for ${args.email} (uid ${uid}) on ${args.project}.`)
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch(err => {
    console.error('grant-internal-entitlement failed:', err.message)
    process.exit(1)
  })
}
