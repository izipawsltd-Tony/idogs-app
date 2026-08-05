/**
 * reconcile-super-admin-dog-cap.mjs
 *
 * One-time, narrowly-scoped reconciliation for a SINGLE already-verified
 * internal Super Admin account whose dogs were restricted BEFORE this
 * round's `unlimited` dog-cap bypass existed (api/_lib/dog-cap.js's
 * capForPlan/reconcileDogCapTx/reactivateUpToCapTx — see that file and
 * scripts/test-super-admin-unlimited-quota.mjs for the underlying fix).
 * Fixes the reported case directly: QA_DAM_20260805 (and any other
 * dog on this account) restricted under the old, effectively-Free-capped
 * behavior can now be safely reactivated with no cap ceiling at all.
 *
 * WHY reactivateUpToCapTx, NOT reconcileDogCapTx:
 * api/reconcile-dog-cap.js (the existing endpoint) calls
 * reconcileDogCapTx(), which only ever REDUCES the active count, plus a
 * narrow special case for CONFIRMED cap-restricted LITTER PUPPIES
 * (isConfirmedCapRestrictedLitterPuppy — see dog-cap.js). QA_DAM_20260805
 * is an ordinary standalone dog (a breeding dam), not a litter puppy, so
 * reconcileDogCapTx would never reactivate it no matter how large the cap
 * is now. reactivateUpToCapTx() is the function that actually restores
 * ordinary restricted dogs, earliest-created-first, up to the (now
 * unlimited) cap — the same function the Stripe upgrade-to-Plus path
 * uses. This script calls it directly via the Admin SDK, exactly once,
 * for exactly one already-verified uid.
 *
 * SAFETY RULES (mirrors scripts/grant-internal-entitlement.mjs):
 *   - Dry-run by default. --execute is required to write anything.
 *   - Hard project-ID guard: the loaded service-account JSON's project_id
 *     MUST match --project exactly, or the script refuses to run.
 *   - Refuses to touch ANY dog unless hasValidInternalEntitlement(profile)
 *     is ALREADY true for the resolved account, read live from Firestore
 *     — this script grants nothing; it only reconciles an account whose
 *     entitlement is already valid. If the entitlement is missing/invalid,
 *     run scripts/grant-internal-entitlement.mjs first.
 *   - Scoped to exactly one uid (resolved via Firebase Auth email lookup,
 *     never a client-supplied UID) — never a batch/all-accounts sweep.
 *   - Idempotent: reactivateUpToCapTx() is a safe no-op when there is
 *     nothing restricted left to reactivate.
 *   - Never deletes, archives, or transfers any dog — only ever changes
 *     `status` from 'restricted' to 'active' (and clears restrictionReason),
 *     the same single field reactivateUpToCapTx always touches.
 *
 * Usage (dry-run — prints what WOULD change, no Firestore write):
 *   node scripts/reconcile-super-admin-dog-cap.mjs \
 *     --project idogs-app-staging \
 *     --sa-path "C:\path\to\idogs-app-staging-service-account.json" \
 *     --email trunghieungo@gmail.com
 *
 *   ...same flags, plus --execute   # actually writes to Firestore
 *
 * Pure argument-parsing/validation (validateArgs) is exported for direct
 * unit testing — see scripts/test-super-admin-unlimited-quota.mjs.
 * Everything that reads a file or talks to Firebase lives in main(),
 * which only runs when this file is executed directly (isMainModule
 * guard at the bottom), never merely on import.
 */

import { readFileSync } from 'fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from './grant-internal-entitlement.mjs'

export function validateArgs(args) {
  if (!args.project || !['idogs-app', 'idogs-app-staging'].includes(args.project)) {
    throw new Error("--project must be exactly 'idogs-app' or 'idogs-app-staging'")
  }
  if (!args.saPath) {
    throw new Error('--sa-path <path to service account JSON> is required')
  }
  if (!args.email) {
    throw new Error('--email <verified internal-admin account email> is required')
  }
  return args
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2))
  const args = validateArgs(rawArgs) // throws before any Firebase/file access
  const DRY_RUN = !args.execute

  // ── HARD GUARD — DO NOT REMOVE ─────────────────────────────────────────
  const saJson = JSON.parse(readFileSync(args.saPath, 'utf8'))
  if (saJson.project_id !== args.project) {
    throw new Error(`Service account project_id ('${saJson.project_id}') does not match --project ('${args.project}') — refusing to run.`)
  }
  // ── END HARD GUARD ──────────────────────────────────────────────────────

  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const { getFirestore } = await import('firebase-admin/firestore')
  const { reactivateUpToCapTx } = await import('../api/_lib/dog-cap.js')
  const { computeEffectivePlan, hasValidInternalEntitlement } = await import('../api/_lib/entitlements.js')

  const app = initializeApp({ credential: cert(saJson) })
  const auth = getAuth(app)
  const db = getFirestore(app)

  console.log('')
  console.log('=================================================================')
  console.log(`  Super Admin dog-cap reconciliation — project: ${args.project}`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : '*** EXECUTE — writing to Firestore ***'}`)
  console.log('=================================================================')
  console.log('')

  const userRecord = await auth.getUserByEmail(args.email)
  const uid = userRecord.uid
  console.log(`Resolved ${args.email} -> uid ${uid}`)

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  if (!userSnap.exists) {
    throw new Error(`users/${uid} does not exist — refusing to proceed.`)
  }
  const profile = userSnap.data()

  console.log('')
  console.log('Current role/plan/entitlement on this account:')
  console.log(`  role:                ${profile.role ?? '(none)'}`)
  console.log(`  plan:                ${profile.plan ?? '(none)'}`)
  console.log(`  internalEntitlement: ${JSON.stringify(profile.internalEntitlement ?? null)}`)

  const unlimited = hasValidInternalEntitlement(profile)
  if (!unlimited) {
    throw new Error(
      `Refusing to proceed: hasValidInternalEntitlement(profile) is false for ${args.email} (uid ${uid}). ` +
      `This script only reconciles an account whose internal entitlement is ALREADY valid — it never grants ` +
      `one. Run scripts/grant-internal-entitlement.mjs first if this account is supposed to be a Super Admin.`
    )
  }
  const plan = computeEffectivePlan(profile)
  console.log(`  effective plan:      ${plan}`)
  console.log(`  unlimited (dog cap): ${unlimited}`)
  console.log('')

  if (DRY_RUN) {
    // A true no-write preview: list every currently-restricted dog this
    // uid owns without calling the real write-capable transaction
    // function at all (reactivateUpToCapTx always writes inside a real
    // db.runTransaction — there is no side-effect-free "preview" mode for
    // it, so dry-run reads the same underlying data directly instead).
    const snap = await db.collection('dogs').where('currentOwnerId', '==', uid).get()
    const restricted = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.status === 'restricted' && d.isDeceased !== true)
    console.log(`Would reactivate up to ${restricted.length} restricted dog(s) (cap is unlimited — no ceiling):`)
    for (const d of restricted) {
      console.log(`  - ${d.id}  "${d.name}"  restrictionReason=${d.restrictionReason ?? '(none)'}`)
    }
    console.log('')
    console.log('Dry-run only — no write performed. Re-run with --execute to apply.')
    return
  }

  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, uid, plan, unlimited))
  console.log('Reactivated:', JSON.stringify(result.reactivated))
  console.log('Confirmed cap-restricted litter puppies reactivated:', JSON.stringify(result.misrestrictedPuppiesReactivated))
  console.log('Remaining restricted (should be 0 with an unlimited cap, unless newly restricted after this ran):', result.remainingRestricted)
  console.log('')
  console.log(`Done. Reconciled dog-cap status for ${args.email} (uid ${uid}) on ${args.project}.`)
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch(err => {
    console.error('reconcile-super-admin-dog-cap failed:', err.message)
    process.exit(1)
  })
}
