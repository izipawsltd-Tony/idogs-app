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
const scanSource = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8')
const passportSource = readFileSync(new URL('../api/passport.js', import.meta.url), 'utf8')
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const createLitterSource = readFileSync(new URL('../api/create-litter.js', import.meta.url), 'utf8')
const updateLitterSource = readFileSync(new URL('../api/update-litter.js', import.meta.url), 'utf8')
const dbSource = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')

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

// ── §2.5/§3.1 AI scan: quota checked before spend, decremented only on success ──

check(
  'scan.js checks remaining quota BEFORE calling the Anthropic API (never spends budget on an already-exhausted account)',
  scanSource.indexOf('remainingScans(profile, plan)') < scanSource.indexOf("fetch('https://api.anthropic.com")
)
check(
  'scan.js only increments usage AFTER a successful response, never inside the response.ok===false branch',
  (() => {
    const errorBranchIdx = scanSource.indexOf("res.status(500).json({ error: 'Claude API error'")
    // Matches only the CALL site (`await incrementScanUsage(...)`), not the
    // function's own `async function incrementScanUsage(...)` declaration
    // earlier in the file, which would otherwise always sort first.
    const incrementCallIdx = scanSource.indexOf('await incrementScanUsage(')
    return errorBranchIdx > -1 && incrementCallIdx > errorBranchIdx
  })()
)
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
check('update-litter.js re-runs the SAME rolling-window check on first-time activation via update (not just at create)', updateLitterSource.includes('hasLitterWithinRollingWindow(tx, db, uid, safePatch.actualBirthDate)'))

// ── Dog creation self-heals the cap without ever blocking creation ────

check(
  'createDog() and createLitterPuppyAtomic() both trigger best-effort cap reconciliation after a successful write — creation itself is never blocked by quota',
  dbSource.includes('reconcileDogCapBestEffort()') &&
    (dbSource.match(/reconcileDogCapBestEffort\(\)/g) || []).length >= 2
)

await summary()
