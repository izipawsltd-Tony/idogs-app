// scripts/test-pricing-integration-checks.mjs — structural/source checks
// for the parts of iDogs Pricing v1.1 that aren't cleanly unit-testable
// in isolation (full HTTP handlers wired directly to firebase-admin, not
// factored for dependency injection like checkout-handler.js/
// webhook-handler.js). Follows this repo's own established convention
// (see test-billing-p0-security.mjs) of asserting on source shape when a
// live emulator/full DI refactor is out of scope for this round.
//
// Usage: node scripts/test-pricing-integration-checks.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const claimSource = readFileSync(new URL('../api/claim-transferred-dogs.js', import.meta.url), 'utf8')
const setStatusSource = readFileSync(new URL('../api/set-dog-status.js', import.meta.url), 'utf8')
const exportSource = readFileSync(new URL('../api/export-report.js', import.meta.url), 'utf8')
const passportSource = readFileSync(new URL('../api/passport.js', import.meta.url), 'utf8')
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const createLitterSource = readFileSync(new URL('../api/create-litter.js', import.meta.url), 'utf8')
const updateLitterSource = readFileSync(new URL('../api/update-litter.js', import.meta.url), 'utf8')
const dbSource = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const createDogSource = readFileSync(new URL('../api/create-dog.js', import.meta.url), 'utf8')
const createLitterPuppySource = readFileSync(new URL('../api/create-litter-puppy.js', import.meta.url), 'utf8')
const dogCapSource = readFileSync(new URL('../api/_lib/dog-cap.js', import.meta.url), 'utf8')
const reconcileLitterPuppySource = readFileSync(new URL('../api/reconcile-litter-puppy.js', import.meta.url), 'utf8')
const dogNewPageSource = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')
const dogDetailPageSource = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

// ── §4.4 Transfer/claim is never blocked by quota ─────────────────────

check(
  'claim-transferred-dogs.js computes room against the buyer\'s OWN cap before assigning status — never rejects the claim itself',
  claimSource.includes('computeEffectivePlan(profile)') &&
    claimSource.includes('capForPlan(plan)') &&
    claimSource.includes('getOwnedActiveDogsSorted(tx, db, uid)') &&
    !/return res\.status\(4\d\d\).*claim/i.test(claimSource) // no 4xx rejection path for the claim action itself
)
check(
  'claim assigns restricted (not a rejection) when the buyer has no room',
  claimSource.includes("grantActive ? 'active' : 'restricted'")
)
check(
  'firestore.rules dogs update rule explicitly still permits a legitimate NEW transfer transition even while restricted',
  rulesSource.includes("resource.data.get('status', 'active') != 'restricted' || isLegitimateNewTransferTransition(resource.data)")
)

// ── §3.2/§3.3 archive/restore and restricted/activate anti-evasion ────

check(
  'set-dog-status.js re-checks the cap (using the SAME transaction\'s dog read) for both activate and restore, not just one',
  setStatusSource.includes("PROMOTING_ACTIONS = new Set(['activate', 'restore'])") &&
    setStatusSource.includes('DOG_CAP_EXCEEDED')
)
check(
  'set-dog-status.js never allows an action on a dog mid-transfer (status/transferStatus takes precedence)',
  setStatusSource.includes("dog.status === 'transferred' || dog.transferStatus === 'pendingClaim'")
)

// ── §1.1 Report/data export is Plus-only; original document download stays free ──

check(
  'export-report.js requires a verified Firebase ID token before touching any data',
  exportSource.includes('getAuth().verifyIdToken(idToken)')
)
check(
  'export-report.js gates PDF/CSV export on the Plus plan',
  exportSource.includes("computeEffectivePlan(profile)") && exportSource.includes("plan !== 'plus'")
)
check(
  'export-report.js verifies dog/litter ownership against the VERIFIED uid, not just the trusted-looking tenantId body param',
  exportSource.includes("data.tenantId !== uid && data.currentOwnerId !== uid") &&
    exportSource.includes("data.tenantId !== uid") // litter scope check
)

// ── §2.5/§3.1 AI scan quota — Codex H3 ────────────────────────────────
// The reserve-before-call / rollback-on-failure / concurrency behavior
// itself is covered by real BEHAVIORAL tests now (Codex Medium item:
// "replace structural/source-order assertions with behavioural retry,
// failure and concurrency tests") — see scripts/test-scan-quota.mjs,
// which exercises api/_lib/scan-quota.js and api/_lib/scan-handler.js
// directly, including a genuine concurrent-reservation race. Only the
// data-protection check (which is a Rules/field-visibility property, not
// a scan.js control-flow property) stays here.
check(
  'AI scan usage counters (freeScansUsed/plusScansUsed/etc) are listed as protected billing fields — a client can never self-grant scans',
  ['freeScansUsed', 'plusScansUsed', 'plusScansPeriodStart', 'scanPeriodAnchorDay'].every(f => rulesSource.includes(`'${f}'`))
)

// ── QR Passport continuity — restricted/archived dogs are unaffected ──

check(
  'api/passport.js never gates its response on dog.status (QR Passport keeps working for restricted/archived dogs)',
  !/if\s*\(.*status.*===.*'restricted'/i.test(passportSource) &&
    !/if\s*\(.*status.*===.*'archived'/i.test(passportSource)
)

// ── §3.4/§4.1 Litter quota wired into BOTH create and activate-on-update paths ──

check('create-litter.js gates Free accounts (0 litter allowance) before any write', createLitterSource.includes('LITTER_PLAN_GATE_MESSAGE'))
check('create-litter.js enforces the rolling-window check against the immutable ledger, not the live litters collection', createLitterSource.includes('hasLitterWithinRollingWindow(tx, db, uid, whelpingDate)'))
check('update-litter.js locks actualBirthDate once activated — no re-dating evasion path', updateLitterSource.includes('LITTER_DATE_LOCKED_MESSAGE'))
check('update-litter.js re-runs the SAME rolling-window check on first-time activation via update (not just at create), self-excluded (Codex H7)', updateLitterSource.includes('hasLitterWithinRollingWindow(tx, db, uid, safePatch.actualBirthDate, litterId)'))

// ── Dog creation is server-enforced and cap-aware; never blocked (Codex H2) ──

check(
  'createDog() (src/lib/db.ts) no longer runs a client-side Firestore transaction — routes through the trusted /api/create-dog endpoint instead',
  dbSource.includes("fetch('/api/create-dog'") && !/export async function createDog[\s\S]{0,400}runTransaction/.test(dbSource)
)
check(
  'firestore.rules denies ALL direct client dogs/{dogId} create — creation is only possible through the trusted server endpoint',
  /match \/dogs\/\{dogId\}\s*\{[\s\S]*?allow create: if false;/.test(rulesSource) &&
    rulesSource.includes('api/create-dog.js')
)
check(
  'api/create-dog.js computes the cap-aware active/restricted status from a live count taken INSIDE the same reservation+write transaction — never blocks creation',
  createDogSource.includes('computeEffectivePlan(profile)') &&
    createDogSource.includes('capForPlan(plan)') &&
    createDogSource.includes('getOwnedActiveDogsSorted(tx, db, uid)') &&
    createDogSource.includes("activeDogs.length >= cap ? 'restricted' : 'active'")
)
// ── Pricing v1.2: litter puppies never cap-check at creation ──
check(
  'api/create-litter-puppy.js (fresh-creation path) no longer computes a cap-aware status at all — every new puppy starts \'active\' unconditionally (Pricing v1.2: litter-managed puppies never consume a cap slot until explicitly promoted)',
  !createLitterPuppySource.includes('getOwnedActiveDogsSorted') &&
    !createLitterPuppySource.includes('capForPlan') &&
    /status: 'active',/.test(createLitterPuppySource)
)
check(
  'api/_lib/dog-cap.js defines the ONE central Pricing v1.2 eligibility predicate, isEligibleForCap()',
  readFileSync(new URL('../api/_lib/dog-cap.js', import.meta.url), 'utf8').includes('export function isEligibleForCap(dog)')
)
check(
  'api/set-dog-status.js is the only place retainedByBreeder is ever written (\'promote\'/\'unpromote\' actions)',
  setStatusSource.includes("RETENTION_ACTIONS = new Set(['promote', 'unpromote'])")
)
check(
  'firestore.rules protects litterId, retainedByBreeder, and restrictionReason from any direct client write (dogProtectedFieldsUnchanged)',
  rulesSource.includes("hasAny(['tenantId', 'currentOwnerId', 'createdByUserId', 'sourceType', 'originBreederId', 'litterId', 'retainedByBreeder', 'restrictionReason'])")
)

// ── Codex fix-round — Finding 1 (HIGH): DogNewPage.tsx's checkLimit()
// must use the same eligibility mirror as backend enforcement, not the
// stale status !== 'transferred' check ──
check(
  'DogNewPage.tsx imports and uses isDogEligibleForCap in checkLimit(), not the old status !== \'transferred\' check',
  /import\s*\{[^}]*isDogEligibleForCap[^}]*\}\s*from\s*'\.\.\/lib\/utils'/.test(dogNewPageSource) &&
    dogNewPageSource.includes('const active = dogs.filter(isDogEligibleForCap)') &&
    !dogNewPageSource.includes("dogs.filter((d: any) => d.status !== 'transferred')")
)

// ── Codex fix-round — Finding 2 (HIGH): DogDetailPage.tsx must expose a
// real UI workflow for promote/unpromote, gated to breeder/effective-
// owner/non-transferred/litter-puppy-only ──
check(
  'DogDetailPage.tsx wires a promote action ("Add to Dog List") and an unpromote reversal ("Return to litter-only")',
  dogDetailPageSource.includes("handleSetDogStatus('promote')") &&
    dogDetailPageSource.includes("handleSetDogStatus('unpromote')")
)
check(
  'DogDetailPage.tsx gates litter-retention actions to breeder-only, current effective owner, non-transferred, litter-puppy-only (never Pet Owner role, former owners, or transferred/pending dogs)',
  /const canManageLitterRetention = !isOwner && isCurrentEffectiveOwner && isLitterPuppy &&\s*\n\s*!isTransferred && !dogIsMidTransfer/.test(dogDetailPageSource)
)
check(
  'DogDetailPage.tsx reuses the single-flight statusActionLoading lock for promote/unpromote/reconcile (prevents duplicate/concurrent requests, same as the existing 4 actions)',
  /disabled=\{statusActionLoading\}[^}]*onClick=\{\(\) => handleSetDogStatus\('promote'\)\}/.test(dogDetailPageSource) &&
    /disabled=\{statusActionLoading\}[^}]*onClick=\{\(\) => handleSetDogStatus\('unpromote'\)\}/.test(dogDetailPageSource) &&
    /disabled=\{statusActionLoading\}[^}]*onClick=\{handleReconcileLitterPuppy\}/.test(dogDetailPageSource)
)
check(
  'DogDetailPage.tsx updates local dog state (status + retainedByBreeder) from the server response after a successful promote/unpromote — usage display reflects success immediately',
  /setDog\(prev => prev \? \{[\s\S]{0,120}\.\.\.\('retainedByBreeder' in body \? \{ retainedByBreeder: body\.retainedByBreeder \} : \{\}\)/.test(dogDetailPageSource)
)
check(
  'api/set-dog-status.js never touches litterId in the promote/unpromote branch — provenance is preserved',
  (() => {
    const start = setStatusSource.indexOf('if (RETENTION_ACTIONS.has(action))')
    const end = setStatusSource.indexOf('if (!FROM_STATUS[action]')
    const retentionBlock = setStatusSource.slice(start, end)
    return start !== -1 && end !== -1 && !retentionBlock.includes('litterId:')
  })()
)

// ── Codex fix-round — Finding 3 (HIGH): reconciliation must be provable,
// not inferred from shape; legacy litter puppies get an explicit, scoped,
// authenticated action instead of automatic reactivation ──
check(
  'api/_lib/dog-cap.js only auto-reactivates a litter puppy when restrictionReason is EXPLICITLY \'plan_cap_exceeded\' — never from shape alone',
  dogCapSource.includes("dog.restrictionReason === 'plan_cap_exceeded'") &&
    !dogCapSource.includes('isMisrestrictedLitterPuppy') // old, shape-only predicate fully removed, not just supplemented
)
check(
  'api/_lib/dog-cap.js\'s demoteExcessToRestricted() tags every cap-driven restriction with restrictionReason:\'plan_cap_exceeded\' — the provable signal reconciliation depends on',
  dogCapSource.includes("restrictionReason: 'plan_cap_exceeded'")
)
check(
  'api/create-dog.js tags an over-cap creation with restrictionReason:\'plan_cap_exceeded\'',
  createDogSource.includes("restrictionReason: 'plan_cap_exceeded'")
)
check(
  'api/claim-transferred-dogs.js tags an over-cap claim with restrictionReason:\'plan_cap_exceeded\'',
  claimSource.includes("restrictionReason: grantActive ? FieldValue.delete() : 'plan_cap_exceeded'")
)
check(
  'api/set-dog-status.js tags a manual restriction with restrictionReason:\'manual\', distinct from cap-driven restrictions',
  setStatusSource.includes("restrict: { restrictionReason: 'manual' }")
)
check(
  'api/reconcile-litter-puppy.js exists as a SEPARATE, per-dog, explicit action — never a blanket/automatic sweep',
  reconcileLitterPuppySource.includes("const { dogId } = body") &&
    !reconcileLitterPuppySource.includes("db.collection('dogs').where(")
)
check(
  'api/reconcile-litter-puppy.js refuses a manually-restricted puppy outright (never silently reactivates it)',
  reconcileLitterPuppySource.includes("dog.restrictionReason === 'manual'") &&
    reconcileLitterPuppySource.includes('MANUALLY_RESTRICTED')
)
check(
  'api/reconcile-litter-puppy.js validates REAL litter ownership (reads the referenced litters/{litterId} document and checks its tenantId) — not just the stored litterId string',
  reconcileLitterPuppySource.includes("db.collection('litters').doc(dog.litterId)") &&
    reconcileLitterPuppySource.includes('litter.tenantId !== uid')
)
check(
  'api/reconcile-litter-puppy.js is tenant-scoped (requires currentOwnerId AND tenantId to match the caller)',
  reconcileLitterPuppySource.includes('dog.currentOwnerId !== uid || dog.tenantId !== uid')
)
check(
  'api/reconcile-litter-puppy.js is idempotent (an already-active dog is a no-op success, not an error)',
  reconcileLitterPuppySource.includes("alreadyActive: true")
)
check(
  'api/reconcile-litter-puppy.js clears restrictionReason on reactivation (no stale reason lingers)',
  /tx\.update\(dogRef, \{ status: 'active', restrictionReason: FieldValue\.delete\(\)/.test(reconcileLitterPuppySource)
)

await summary()
