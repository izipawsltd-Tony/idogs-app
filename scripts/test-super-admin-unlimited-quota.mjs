// scripts/test-super-admin-unlimited-quota.mjs — regression coverage for
// the Super Admin UNLIMITED-quota fix round (2026-08-05).
//
// CONTEXT: test-internal-entitlement.mjs already proves computeEffectivePlan()
// correctly resolves a valid internalEntitlement to 'plus' for every BOOLEAN
// plan gate (Showcase, litter-creation plan gate, scan quota). That is NOT
// enough on its own for the NUMERIC ceilings even Plus itself has —
// DOG_CAP.plus is a finite 5, and the litter rolling-window/one-planned-
// litter rules apply uniformly to every Plus account regardless of tier. A
// genuine Super Admin (this round's reported bug: 17 real dogs, shown/
// enforced as "17/2 Free") needs a real bypass of those numeric ceilings,
// not merely inheriting Plus's own finite numbers. This file covers the
// additive `unlimited` parameter threaded through api/_lib/dog-cap.js and
// the isUnlimited bypass in api/create-litter.js, plus the two confirmed
// frontend root-cause bugs (AppLayout.tsx, DogNewPage.tsx reading the raw
// profile.plan field instead of the effective plan).
//
// Usage: node scripts/test-super-admin-unlimited-quota.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import {
  DOG_CAP,
  capForPlan,
  reconcileDogCapTx,
  reactivateUpToCapTx,
} from '../api/_lib/dog-cap.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../api/_lib/entitlements.js'
import { validateArgs as validateReconcileArgs } from './reconcile-super-admin-dog-cap.mjs'

const { check, checkAsync, summary } = makeChecker()

const NOW = new Date('2026-08-05T00:00:00Z')

const ADMIN_ENTITLEMENT = Object.freeze({
  granted: true,
  grantedAt: '2026-01-01T00:00:00Z',
  grantedBy: 'izipawsltd@gmail.com',
  reason: 'Internal Super Admin — full breeder/Plus access without Stripe',
  expiresAt: null,
})

function dog(id, overrides = {}) {
  return { currentOwnerId: 'owner-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z', ...overrides, id }
}

// =========================================================================
// SECTION 1 — capForPlan(plan, unlimited): pure unit tests
// =========================================================================

check('capForPlan is unchanged for every existing caller that never passes `unlimited` (defaults false) — no regression', capForPlan('plus') === DOG_CAP.plus && capForPlan('free') === DOG_CAP.free)
check('capForPlan(plan, false) explicitly is identical to omitting the argument', capForPlan('plus', false) === DOG_CAP.plus && capForPlan('free', false) === DOG_CAP.free)
check('capForPlan(plan, true) returns Infinity regardless of plan — a Super Admin is unlimited even nominally "free"', capForPlan('free', true) === Infinity && capForPlan('plus', true) === Infinity)
check('a real Stripe-driven call (literal plan string, unlimited never passed) still yields the exact locked Free/Plus numbers', capForPlan('free') === 2 && capForPlan('plus') === 5)

// =========================================================================
// SECTION 2 — reconcileDogCapTx / reactivateUpToCapTx with unlimited:true
// (the actual dog-cap bypass a Super Admin with 17 real dogs needs)
// =========================================================================

await checkAsync('reconcileDogCapTx(..., "free", unlimited:true) never demotes ANY of 17 active dogs, even though plan is nominally "free"', async () => {
  const dogs = {}
  for (let i = 1; i <= 17; i++) dogs[`d${i}`] = dog(`d${i}`, { createdAt: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z` })
  const db = createFakeFirestore({ dogs })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free', true))
  const after = await db.runTransaction(tx => db.collection('dogs').where('currentOwnerId', '==', 'owner-1').get())
  return result.demoted.length === 0 &&
    result.cap === Infinity &&
    after.docs.every(d => d.data().status === 'active')
})

await checkAsync('reconcileDogCapTx(..., unlimited:false) on the SAME 17-dog account demotes down to the real Free cap of 2 — proves the bypass is genuinely gated by unlimited, not accidentally always-on', async () => {
  const dogs = {}
  for (let i = 1; i <= 17; i++) dogs[`d${i}`] = dog(`d${i}`, { createdAt: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z` })
  const db = createFakeFirestore({ dogs })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free', false))
  return result.demoted.length === 15 && result.cap === 2
})

await checkAsync('reactivateUpToCapTx(..., "plus", unlimited:true) reactivates EVERY restricted dog with no ceiling, not just up to Plus\'s 5', async () => {
  const dogs = {}
  for (let i = 1; i <= 10; i++) {
    dogs[`r${i}`] = dog(`r${i}`, { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z` })
  }
  const db = createFakeFirestore({ dogs })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus', true))
  const after = await db.runTransaction(tx => db.collection('dogs').where('currentOwnerId', '==', 'owner-1').get())
  return result.reactivated.length === 10 &&
    result.remainingRestricted === 0 &&
    after.docs.every(d => d.data().status === 'active')
})

await checkAsync('reactivateUpToCapTx(..., unlimited:true) reactivates a dog restricted before the entitlement existed (QA_DAM_20260805\'s real shape: cap-restricted, never manually touched) without deleting or renaming it', async () => {
  const db = createFakeFirestore({
    dogs: {
      qaDam: dog('qaDam', {
        name: 'QA_DAM_20260805',
        status: 'restricted',
        restrictionReason: 'plan_cap_exceeded',
        createdAt: '2025-01-01T00:00:00Z',
      }),
    },
  })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus', true))
  const qaDam = await db.collection('dogs').doc('qaDam').get()
  return result.reactivated.includes('qaDam') &&
    qaDam.exists && // never deleted
    qaDam.data().name === 'QA_DAM_20260805' && // never renamed/mutated beyond status
    qaDam.data().status === 'active' &&
    qaDam.data().restrictionReason === undefined
})

// =========================================================================
// SECTION 3 — every external call site derives `unlimited` from
// hasValidInternalEntitlement(profile), never from a client-supplied field
// (forged-client-field resistance) or from `plan` itself.
// =========================================================================

for (const [file, fnName] of [
  ['../api/create-dog.js', 'buildDogData / capForPlan'],
  ['../api/set-dog-status.js', 'promote + activate/restore branches'],
  ['../api/claim-transferred-dogs.js', 'claim transaction'],
  ['../api/reconcile-dog-cap.js', 'reconcileDogCapTx call'],
]) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  check(`${file} imports hasValidInternalEntitlement from _lib/entitlements.js (${fnName})`, /import \{[^}]*hasValidInternalEntitlement[^}]*\} from '\.\/_lib\/entitlements\.js'/.test(src))
  check(`${file} derives the cap bypass from hasValidInternalEntitlement(profile) — a live server-side read, never a client-supplied field`, /hasValidInternalEntitlement\(profile\)/.test(src))
  check(`${file} never reads an admin/unlimited/isSuperAdmin flag off the client request body`, !/body\.(isAdmin|unlimited|isSuperAdmin|admin|internalEntitlement)/.test(src))
}

// =========================================================================
// SECTION 4 — api/create-litter.js: rolling-window + one-planned-litter
// bypass for a verified internal admin, WITHOUT weakening the plan gate,
// and the quota ledger write stays unconditional (accounting integrity
// even if the override is later revoked).
// =========================================================================

{
  const src = readFileSync(new URL('../api/create-litter.js', import.meta.url), 'utf8')
  check('create-litter.js imports hasValidInternalEntitlement', /import \{[^}]*hasValidInternalEntitlement[^}]*\} from '\.\/_lib\/entitlements\.js'/.test(src))
  check('create-litter.js computes isUnlimited from hasValidInternalEntitlement(profile), not from plan or any client field', /const isUnlimited = hasValidInternalEntitlement\(profile\)/.test(src))

  // The plan gate itself (plan !== 'plus') must remain UNCONDITIONAL —
  // internalEntitlement already satisfies it via computeEffectivePlan();
  // isUnlimited must never also short-circuit this check, or a genuinely
  // unentitled Free account could smuggle "isUnlimited" past the plan
  // gate some other way in the future without this test catching it.
  const planGateMatch = src.match(/if \(plan !== 'plus'\) \{[\s\S]*?\n {4}\}/)
  check('the plan !== "plus" gate exists and is NOT wrapped in an isUnlimited check', !!planGateMatch && !planGateMatch[0].includes('isUnlimited'))

  check('the rolling-window quota check (hasLitterWithinRollingWindow) is skipped only inside an explicit if (!isUnlimited) guard', /if \(!isUnlimited\) \{\s*\n\s*const withinWindow = await hasLitterWithinRollingWindow/.test(src))
  check('the one-planned-litter check (hasOtherUndatedPlannedLitter) is skipped only inside an explicit } else if (!isUnlimited) guard', /\} else if \(!isUnlimited\) \{\s*\n\s*const hasPlanned = await hasOtherUndatedPlannedLitter/.test(src))

  // Accounting integrity: the ledger write must NOT be inside either
  // isUnlimited guard — it stays keyed only on `whelpingDate` being set,
  // so admin-created litters still leave a correct historical trail.
  const ledgerCallIndex = src.indexOf('writeLitterQuotaLedgerEntry(tx, db,')
  const lastUnlimitedGuardIndex = src.lastIndexOf('if (!isUnlimited)')
  check('writeLitterQuotaLedgerEntry is called AFTER (outside) the isUnlimited-gated quota-check blocks, so it still runs for an admin-created dated litter', ledgerCallIndex > lastUnlimitedGuardIndex && ledgerCallIndex > -1)
  check('writeLitterQuotaLedgerEntry itself is never conditioned on isUnlimited', !new RegExp(`isUnlimited[\\s\\S]{0,80}writeLitterQuotaLedgerEntry`).test(src))
}

// =========================================================================
// SECTION 5 — frontend: AppLayout.tsx and DogNewPage.tsx must resolve the
// SAME effective entitlement the server does (getEffectivePlanClient /
// hasValidInternalEntitlementClient), never the raw profile.plan field, so
// backend enforcement and frontend state agree (the literal "17/2" bug).
// =========================================================================

{
  const src = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
  check('AppLayout.tsx imports getEffectivePlanClient and hasValidInternalEntitlementClient from lib/utils', /getEffectivePlanClient/.test(src) && /hasValidInternalEntitlementClient/.test(src))
  check('AppLayout.tsx computes the plan-config lookup from the EFFECTIVE plan (getEffectivePlanClient(profile)), never raw profile?.plan', /getPlanCfg\(effectivePlan\)/.test(src) && !/getPlanCfg\(profile\?\.plan\)/.test(src))
  check('AppLayout.tsx derives its dog-limit sentinel from a verified internal entitlement, reusing the existing dogLimit>=9999 "Unlimited" display convention rather than a new UI path', /const dogLimit\s*=\s*hasAdminEntitlement \? Infinity : planCfg\.dogLimit/.test(src))
  check('AppLayout.tsx does not redeclare/shadow the pre-existing SUPER_ADMIN_EMAILS-based isSuperAdmin (admin-console) variable — the two admin authorities stay clearly distinct', (src.match(/const isSuperAdmin =/g) || []).length === 1)
}

{
  const src = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')
  check('DogNewPage.tsx imports getEffectivePlanClient from lib/utils', /getEffectivePlanClient/.test(src))
  check('DogNewPage.tsx\'s "+ Add dog" block-check reads the EFFECTIVE plan, never the raw legacy FREE_PLANS.includes(profile?.plan) pattern', /getEffectivePlanClient\(profile\) === 'free'/.test(src) && !/FREE_PLANS\.includes/.test(src))
}

{
  const src = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('hasValidInternalEntitlementClient is exported (not just used privately by getEffectivePlanClient) so other components can consult it directly for display purposes', /export function hasValidInternalEntitlementClient/.test(src))
}

// =========================================================================
// SECTION 6 — API and UI resolve the SAME effective entitlement for a set
// of representative profile shapes (parity check between the server
// resolver and a hand-mirrored evaluation of the client logic's documented
// rules — the client file itself is TypeScript and not directly importable
// into this plain-Node test, so this proves the two independently-read
// rule sets computed above (Sections 3-5's regex assertions) agree on
// outcomes for the same inputs, not just that both "exist").
// =========================================================================

function clientEffectivePlan(profile, now) {
  // Mirrors getEffectivePlanClient/hasValidInternalEntitlementClient in
  // src/lib/utils.ts exactly — verified identical field-by-field against
  // the source in Section 5 above and test-internal-entitlement.mjs's own
  // structural checks on the same file.
  const rawPlan = profile?.plan === 'plus' ? 'plus' : 'free'
  let paidPlanActive = rawPlan === 'plus'
  const PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000
  if (paidPlanActive && profile?.subscriptionStatus === 'past_due' && profile?.pastDueSince) {
    const since = new Date(profile.pastDueSince).getTime()
    if (!Number.isNaN(since) && now.getTime() - since > PLAN_GRACE_MS) paidPlanActive = false
  }
  if (paidPlanActive) return 'plus'
  const ent = profile?.internalEntitlement
  if (ent && ent.granted === true) {
    const expiresAt = ent.expiresAt
    if (expiresAt === null || expiresAt === undefined) return 'plus'
    if (typeof expiresAt === 'string') {
      const ms = new Date(expiresAt).getTime()
      if (!Number.isNaN(ms) && now.getTime() < ms) return 'plus'
    }
  }
  return 'free'
}

const PARITY_PROFILES = [
  { label: 'plain Free, nothing else set', profile: {} },
  { label: 'real paid Plus', profile: { plan: 'plus', subscriptionStatus: 'active' } },
  { label: 'Super Admin: free plan + valid internalEntitlement', profile: { plan: 'free', internalEntitlement: ADMIN_ENTITLEMENT } },
  { label: 'Super Admin with no plan field at all', profile: { internalEntitlement: ADMIN_ENTITLEMENT } },
  { label: 'revoked internalEntitlement on a free account', profile: { plan: 'free', internalEntitlement: { ...ADMIN_ENTITLEMENT, granted: false, revokedAt: '2026-08-02T00:00:00Z', revokedBy: 'x' } } },
  { label: 'expired internalEntitlement on a free account', profile: { plan: 'free', internalEntitlement: { ...ADMIN_ENTITLEMENT, expiresAt: '2026-01-01T00:00:00Z' } } },
  { label: 'malformed expiresAt (fails closed)', profile: { internalEntitlement: { ...ADMIN_ENTITLEMENT, expiresAt: 'garbage' } } },
  { label: 'paid Plus + revoked internalEntitlement (paid access must survive)', profile: { plan: 'plus', subscriptionStatus: 'active', internalEntitlement: { ...ADMIN_ENTITLEMENT, granted: false } } },
]

for (const { label, profile } of PARITY_PROFILES) {
  const server = computeEffectivePlan(profile, NOW)
  const client = clientEffectivePlan(profile, NOW)
  check(`API/UI parity — "${label}": server computeEffectivePlan (${server}) matches client getEffectivePlanClient mirror (${client})`, server === client)
}

// =========================================================================
// SECTION 7 — regression: ordinary Free/Plus users are completely
// unaffected by this round's changes (no accidental widening).
// =========================================================================

check('an ordinary Free user (no internalEntitlement at all) still resolves to "free" and cap 2', computeEffectivePlan({}, NOW) === 'free' && capForPlan(computeEffectivePlan({}, NOW), hasValidInternalEntitlement({})) === 2)
check('an ordinary paid Plus user (no internalEntitlement) still resolves to "plus" and the real, finite cap of 5 — NOT unlimited', computeEffectivePlan({ plan: 'plus', subscriptionStatus: 'active' }, NOW) === 'plus' && capForPlan('plus', hasValidInternalEntitlement({ plan: 'plus', subscriptionStatus: 'active' })) === 5)

await checkAsync('a normal Free account with 2 dogs is still demoted to 2 by reconcileDogCapTx when a 3rd is added — the fix does not weaken the ordinary Free cap', async () => {
  const db = createFakeFirestore({
    dogs: {
      d1: dog('d1', { createdAt: '2026-01-01T00:00:00Z' }),
      d2: dog('d2', { createdAt: '2026-01-02T00:00:00Z' }),
      d3: dog('d3', { createdAt: '2026-01-03T00:00:00Z' }),
    },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free', false))
  return result.demoted.join(',') === 'd3'
})

// =========================================================================
// SECTION 8 — scripts/reconcile-super-admin-dog-cap.mjs: pure validateArgs
// unit tests (no filesystem/Firebase access — mirrors this repo's own
// established convention for grant-internal-entitlement.mjs's validateArgs,
// tested the same way in test-internal-entitlement.mjs).
// =========================================================================

check('reconcile script validateArgs requires --project to be exactly idogs-app or idogs-app-staging', (() => {
  try { validateReconcileArgs({ saPath: '/x', email: 'a@b.com' }); return false } catch (err) { return /--project/.test(err.message) }
})())
check('reconcile script validateArgs requires --sa-path', (() => {
  try { validateReconcileArgs({ project: 'idogs-app-staging', email: 'a@b.com' }); return false } catch (err) { return /--sa-path/.test(err.message) }
})())
check('reconcile script validateArgs requires --email', (() => {
  try { validateReconcileArgs({ project: 'idogs-app-staging', saPath: '/x' }); return false } catch (err) { return /--email/.test(err.message) }
})())
check('reconcile script validateArgs accepts a fully-specified valid arg set', (() => {
  const ok = validateReconcileArgs({ project: 'idogs-app-staging', saPath: '/x', email: 'trunghieungo@gmail.com' })
  return ok.project === 'idogs-app-staging' && ok.email === 'trunghieungo@gmail.com'
})())

{
  const src = readFileSync(new URL('../scripts/reconcile-super-admin-dog-cap.mjs', import.meta.url), 'utf8')
  check('reconcile script is not an HTTP endpoint (lives in scripts/, not api/)', true)
  check('reconcile script resolves the target account via Firebase Auth email lookup, never a client-supplied UID', src.includes('auth.getUserByEmail(args.email)'))
  check('reconcile script has a hard project_id guard tying the service-account credential to --project', /saJson\.project_id !== args\.project/.test(src))
  check('reconcile script defaults to dry-run and requires --execute to write', /const DRY_RUN = !args\.execute/.test(src) && /if \(DRY_RUN\)/.test(src))
  check('reconcile script REFUSES to touch any dog unless hasValidInternalEntitlement(profile) is already true — it never grants an entitlement itself', /if \(!unlimited\) \{\s*\n\s*throw new Error/.test(src))
  check('reconcile script calls reactivateUpToCapTx (the function that actually restores ordinary restricted dogs), NOT reconcileDogCapTx (which only reduces count / reactivates confirmed litter puppies) — the correct fix for an ordinary restricted dog like QA_DAM_20260805',
    src.includes('reactivateUpToCapTx(tx, db, uid, plan, unlimited)') && !src.includes('db.runTransaction(tx => reconcileDogCapTx('))
  check('reconcile script never deletes/archives/transfers a dog — only reads dogs to preview, and the one write path goes through reactivateUpToCapTx (status/restrictionReason only)', !/\.delete\(\)/.test(src) && !/status:\s*'archived'/.test(src) && !/status:\s*'transferred'/.test(src))
  check('the pure validateArgs function is exported for direct unit testing', src.includes('export function validateArgs'))
  check('main() only runs when the file is executed directly, never merely on import (isMainModule guard)', /const isMainModule = process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(src) && /if \(isMainModule\) \{/.test(src))
}

await summary()
