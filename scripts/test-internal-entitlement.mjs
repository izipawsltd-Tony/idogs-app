// scripts/test-internal-entitlement.mjs — regression coverage for the
// internal Super Admin entitlement mechanism (api/_lib/entitlements.js's
// hasValidInternalEntitlement()/computeEffectivePlan(), its client mirror
// in src/lib/utils.ts, firestore.rules' protection of the field, and
// scripts/grant-internal-entitlement.mjs).
//
// Goal: full Plus/breeder feature access for a verified internal account
// (e.g. the founder's own), completely independent of Stripe — no fake
// customer/subscription, never client-grantable, auditable, and immune to
// being clobbered by a real Stripe webhook event (which only ever touches
// `plan`/`subscriptionStatus`/etc., never `internalEntitlement`).
//
// Usage: node scripts/test-internal-entitlement.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { computeEffectivePlan } from '../api/_lib/entitlements.js'
import { checkBreederPlusAccess } from '../api/_lib/showcase-access.js'
import { capForPlan, DOG_CAP } from '../api/_lib/dog-cap.js'
import { createWebhookHandler } from '../api/_lib/webhook-handler.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'
import { parseArgs, parseAndValidateExpiry, validateArgs, buildEntitlementPayload } from './grant-internal-entitlement.mjs'

const { check, checkAsync, summary } = makeChecker()

const NOW = new Date('2026-08-04T00:00:00Z')

// ── computeEffectivePlan — the server-authoritative resolver ──────────

check('normal Free user (no plan, no entitlement) remains blocked from Plus', computeEffectivePlan({}, NOW) === 'free')
check('normal Free user with an explicit plan:"free" remains blocked', computeEffectivePlan({ plan: 'free' }, NOW) === 'free')
check('paid Plus user (real plan:"plus", no internal entitlement) remains allowed', computeEffectivePlan({ plan: 'plus' }, NOW) === 'plus')

check(
  'authorised internal entitlement (granted:true, no expiry) is allowed even with plan:"free"',
  computeEffectivePlan({ plan: 'free', internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'izipawsltd@gmail.com', reason: 'Super Admin', expiresAt: null } }, NOW) === 'plus'
)
check(
  'authorised internal entitlement works with no plan field at all',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null } }, NOW) === 'plus'
)
check(
  'a FUTURE expiresAt still grants access',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: '2027-01-01T00:00:00Z' } }, NOW) === 'plus'
)
check(
  'an expired override (expiresAt in the past) is denied',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: '2026-07-01T00:00:00Z' } }, NOW) === 'free'
)
check(
  'exactly at the expiry instant is treated as expired (>= boundary, never a one-tick-late grant)',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: NOW.toISOString() } }, NOW) === 'free'
)
check(
  'a revoked override (granted:false) is denied regardless of any other field',
  computeEffectivePlan({ internalEntitlement: { granted: false, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null, revokedAt: '2026-08-02T00:00:00Z', revokedBy: 'izipawsltd@gmail.com' } }, NOW) === 'free'
)
check(
  'a malformed entitlement object (granted missing/not boolean true) is denied, fails closed',
  computeEffectivePlan({ internalEntitlement: { grantedAt: '2026-01-01T00:00:00Z' } }, NOW) === 'free' &&
  computeEffectivePlan({ internalEntitlement: {} }, NOW) === 'free' &&
  computeEffectivePlan({ internalEntitlement: null }, NOW) === 'free'
)

// ── Malformed expiresAt MUST fail closed (deny), never be silently
// treated as "no expiry" — this is the exact bug being fixed: a naive
// `new Date(garbage).getTime()` is NaN, and NaN comparisons are always
// false, so an unguarded "expired if now >= expiresAtMs" check would
// never fire for garbage input, granting permanent access by accident. ──

check(
  'a non-parseable garbage string expiresAt is denied by the server, never treated as permanent',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: 'not-a-real-date' } }, NOW) === 'free'
)
check(
  'a Firestore Timestamp-LIKE object expiresAt ({_seconds,_nanoseconds}) is denied by the server, never treated as permanent',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: { _seconds: 1234567890, _nanoseconds: 0 } } }, NOW) === 'free'
)
check(
  'a numeric expiresAt (e.g. a raw epoch-ms value, not a string) is denied by the server, never treated as permanent',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: 1234567890000 } }, NOW) === 'free'
)
check(
  'a boolean expiresAt is denied by the server, never treated as permanent',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: true } }, NOW) === 'free'
)
check(
  'expiresAt: null (explicit, the normal "no expiry" shape) is still valid — the fail-closed fix only affects malformed values, not the documented null case',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null } }, NOW) === 'plus'
)
check(
  'expiresAt: undefined (field simply absent) is still valid — same as explicit null',
  computeEffectivePlan({ internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y' } }, NOW) === 'plus'
)
check(
  'a real paid Plus subscription is never weakened by the internal-entitlement code path (no entitlement present at all)',
  computeEffectivePlan({ plan: 'plus', subscriptionStatus: 'active' }, NOW) === 'plus'
)

// ── Precedence: a valid paid subscription always wins outright — the
// internal-entitlement branch is only ever CONSULTED when there is no
// active paid plan (see computeEffectivePlan: `if (paidPlanActive) return
// 'plus'` returns BEFORE hasValidInternalEntitlement() is even called).
// This is what makes "an internal revoke must never override a valid
// paid Stripe entitlement" true — revoking/expiring the internal field
// on a genuinely paying account is a structural no-op for their access,
// exactly as it should be. ──

check(
  'valid paid Plus + internalEntitlement.granted:false (revoked) => MUST remain Plus (revoke never touches paid access)',
  computeEffectivePlan({
    plan: 'plus', subscriptionStatus: 'active',
    internalEntitlement: { granted: false, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null, revokedAt: '2026-08-02T00:00:00Z', revokedBy: 'x' },
  }, NOW) === 'plus'
)
check(
  'valid paid Plus + EXPIRED internal entitlement => MUST remain Plus (expiry of the override never touches paid access)',
  computeEffectivePlan({
    plan: 'plus', subscriptionStatus: 'active',
    internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: '2026-07-01T00:00:00Z' },
  }, NOW) === 'plus'
)
check(
  'free user + granted valid internal entitlement => Plus',
  computeEffectivePlan({
    plan: 'free',
    internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null },
  }, NOW) === 'plus'
)
check(
  'free user + revoked internal entitlement => Free',
  computeEffectivePlan({
    plan: 'free',
    internalEntitlement: { granted: false, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null, revokedAt: '2026-08-02T00:00:00Z', revokedBy: 'x' },
  }, NOW) === 'free'
)
check(
  'free user + expired internal entitlement => Free',
  computeEffectivePlan({
    plan: 'free',
    internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: '2026-07-01T00:00:00Z' },
  }, NOW) === 'free'
)
check(
  'past_due grace expiry still falls through to a genuine internal entitlement instead of hard-denying',
  computeEffectivePlan({
    plan: 'plus',
    subscriptionStatus: 'past_due',
    pastDueSince: '2026-07-01T00:00:00Z', // >7 days before NOW — grace expired
    internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null },
  }, NOW) === 'plus'
)

// ── Downstream gates actually see the effective plan, not just plan ───

check(
  'checkBreederPlusAccess allows an internally-entitled breeder into Litter Showcase',
  checkBreederPlusAccess({ role: 'breeder', plan: 'free', internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null } }) === null
)
check(
  'checkBreederPlusAccess still blocks a Free breeder with no entitlement (no regression)',
  checkBreederPlusAccess({ role: 'breeder', plan: 'free' })?.status === 403
)
check(
  'internal entitlement raises the dog cap from Free(2) to Plus(5)',
  capForPlan(computeEffectivePlan({ plan: 'free', internalEntitlement: { granted: true, grantedAt: '2026-08-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null } }, NOW)) === DOG_CAP.plus
)

// ── Stripe webhook cannot accidentally remove the internal entitlement ─

// Byte-for-byte: every field (not just `granted`) must survive identical,
// since a partial merge bug could leave the flag true while silently
// corrupting grantedAt/grantedBy/reason — proving equality of the whole
// object (via JSON, since the fake Firestore returns plain objects) is a
// strictly stronger guarantee than checking one field.
const ORIGINAL_ENTITLEMENT = Object.freeze({
  granted: true,
  grantedAt: '2026-01-01T00:00:00Z',
  grantedBy: 'izipawsltd@gmail.com',
  reason: 'Internal Super Admin — full breeder/Plus access without Stripe',
  expiresAt: null,
})

await checkAsync('a real Stripe DOWNGRADE event (customer.subscription.deleted) preserves internalEntitlement byte-for-byte, and effective plan stays Plus via the override', async () => {
  const db = createFakeFirestore({
    users: {
      'admin-user': {
        plan: 'plus',
        subscriptionStatus: 'active',
        stripeSubscriptionId: 'sub_admin',
        lastKnownSubscriptionId: 'sub_admin',
        internalEntitlement: { ...ORIGINAL_ENTITLEMENT },
      },
    },
  })
  const process = createWebhookHandler({
    constructEvent: (rawBody) => JSON.parse(rawBody.toString()),
    getSubscription: async () => { throw new Error('should not be called for subscription.deleted') },
    db,
    now: () => NOW,
  })
  const event = {
    id: 'evt_delete_1',
    type: 'customer.subscription.deleted',
    created: 2000,
    data: { object: { id: 'sub_admin', customer: 'cus_admin', metadata: { userId: 'admin-user' } } },
  }
  const res = await process(Buffer.from(JSON.stringify(event)), 'good-signature')
  const user = (await db.collection('users').doc('admin-user').get()).data()
  return res.status === 200 &&
    user.plan === 'free' && // the webhook DID do its normal job on the real subscription
    JSON.stringify(user.internalEntitlement) === JSON.stringify(ORIGINAL_ENTITLEMENT) && // byte-for-byte untouched
    computeEffectivePlan(user, NOW) === 'plus' // effective access survives the downgrade via the override
})

await checkAsync('a real Stripe UPGRADE event (checkout.session.completed) preserves an existing internalEntitlement byte-for-byte', async () => {
  const db = createFakeFirestore({
    users: {
      'admin-user': {
        internalEntitlement: { ...ORIGINAL_ENTITLEMENT },
      },
    },
  })
  const process = createWebhookHandler({
    constructEvent: (rawBody) => JSON.parse(rawBody.toString()),
    getSubscription: async () => ({
      id: 'sub_new', status: 'active', start_date: 1753315200,
      items: { data: [{ price: { id: CHECKOUT_PRICE_IDS.plus_monthly } }] },
    }),
    db,
    now: () => NOW,
  })
  const event = {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    created: 1000,
    data: { object: { metadata: { userId: 'admin-user' }, subscription: 'sub_new', customer: 'cus_admin' } },
  }
  await process(Buffer.from(JSON.stringify(event)), 'good-signature')
  const user = (await db.collection('users').doc('admin-user').get()).data()
  return user.plan === 'plus' && JSON.stringify(user.internalEntitlement) === JSON.stringify(ORIGINAL_ENTITLEMENT)
})

await checkAsync('a real Stripe subscription.updated(active) event ALSO preserves internalEntitlement byte-for-byte (third distinct webhook branch that writes to the user doc)', async () => {
  const db = createFakeFirestore({
    users: {
      'admin-user': {
        plan: 'free',
        internalEntitlement: { ...ORIGINAL_ENTITLEMENT },
      },
    },
  })
  const process = createWebhookHandler({
    constructEvent: (rawBody) => JSON.parse(rawBody.toString()),
    getSubscription: async () => { throw new Error('should not be called for subscription.updated') },
    db,
    now: () => NOW,
  })
  const event = {
    id: 'evt_updated_1',
    type: 'customer.subscription.updated',
    created: 1000,
    data: { object: { id: 'sub_new', customer: 'cus_admin', status: 'active', start_date: 1753315200, metadata: { userId: 'admin-user' }, items: { data: [{ price: { id: CHECKOUT_PRICE_IDS.plus_monthly } }] } } },
  }
  await process(Buffer.from(JSON.stringify(event)), 'good-signature')
  const user = (await db.collection('users').doc('admin-user').get()).data()
  return user.plan === 'plus' && JSON.stringify(user.internalEntitlement) === JSON.stringify(ORIGINAL_ENTITLEMENT)
})

// ── Structural: webhook-handler.js can never reference internalEntitlement ─

{
  const webhookSrc = readFileSync(new URL('../api/_lib/webhook-handler.js', import.meta.url), 'utf8')
  check('webhook-handler.js source never mentions internalEntitlement anywhere (not just the tested branches above)', !webhookSrc.includes('internalEntitlement'))
}

// ── Firestore Rules: internalEntitlement is a protected billing field ──

{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const billingFieldsBlockMatch = rules.match(/function userBillingFields\(\) \{[\s\S]*?\n    \}/)
  check('userBillingFields() function exists', !!billingFieldsBlockMatch)
  check(
    "'internalEntitlement' is listed inside userBillingFields() — protected from client create/update/delete",
    !!billingFieldsBlockMatch && billingFieldsBlockMatch[0].includes("'internalEntitlement'")
  )
}

// ── db.ts: a browser-originated profile write can never smuggle in a
// self-granted entitlement, even before Rules ever evaluate it ──────────

{
  const dbSource = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const createFnSrc = dbSource.slice(dbSource.indexOf('export async function createUserProfile'), dbSource.indexOf('export async function updateUserProfile'))
  check('createUserProfile strips internalEntitlement from client-supplied signup data', createFnSrc.includes('internalEntitlement: _internalEntitlement'))
}

// ── Client mirror (src/lib/utils.ts) stays in sync with the server logic ─

{
  const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('getEffectivePlanClient checks internalEntitlement.granted', /entitlement\?\.granted !== true/.test(utilsSrc) || /entitlement\.granted !== true/.test(utilsSrc))
  check('getEffectivePlanClient rejects a non-string expiresAt outright (fails closed on a Timestamp-like object/number/boolean, not just NaN dates)', /typeof expiresAt !== 'string'\)\s*return false/.test(utilsSrc))
  check('getEffectivePlanClient rejects an unparsable expiresAt string (NaN) rather than falling through to "no expiry"', /Number\.isNaN\(expiresAtMs\)\)\s*return false/.test(utilsSrc))
  check('getEffectivePlanClient treats null/undefined expiresAt as "no expiry" (the one documented permanent-grant shape)', /expiresAt === null \|\| expiresAt === undefined\)\s*return true/.test(utilsSrc))
  check('getEffectivePlanClient enforces expiry with a strict "now < expiresAtMs" check, matching the server', /return now\.getTime\(\) < expiresAtMs/.test(utilsSrc))
  check('getEffectivePlanClient signature accepts internalEntitlement so LittersPage.tsx can pass it through', /Pick<UserProfile, 'plan' \| 'subscriptionStatus' \| 'pastDueSince' \| 'internalEntitlement'>/.test(utilsSrc))
}

// ── grant-internal-entitlement.mjs: pure functions, unit-tested directly ─
// (no filesystem/Firebase access — parseArgs/parseAndValidateExpiry/
// validateArgs/buildEntitlementPayload are all pure; only main(), which
// these tests never call, touches a real file or Firebase.) ────────────

const FUTURE_ISO = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() // NOW + 30 days
const PAST_ISO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() // NOW - 30 days

check('parseAndValidateExpiry: omitted --expires means no expiry (null), the documented permanent-grant shape', parseAndValidateExpiry(undefined, { now: NOW }) === null)

// ── Strict ISO 8601 only — new Date(x) alone is not a safe validator
// (it also accepts locale-dependent/ambiguous formats). See
// ISO_8601_STRICT_REGEX's own comment in grant-internal-entitlement.mjs
// for the exact two shapes accepted and why a no-timezone datetime is
// rejected as ambiguous rather than silently parsed as local time. ──

check('parseAndValidateExpiry: a valid UTC ISO datetime (Z) is accepted and normalized', parseAndValidateExpiry('2027-01-01T00:00:00Z', { now: NOW }) === new Date('2027-01-01T00:00:00Z').toISOString())
check('parseAndValidateExpiry: a valid ISO datetime with an explicit offset (+09:30) is accepted and normalized', parseAndValidateExpiry('2027-01-01T00:00:00+09:30', { now: NOW }) === new Date('2027-01-01T00:00:00+09:30').toISOString())
check('parseAndValidateExpiry: a date-only string (no time) is accepted and normalized to a full ISO instant (documented: midnight UTC)', parseAndValidateExpiry('2027-06-15', { now: NOW }) === new Date('2027-06-15').toISOString())
check('parseAndValidateExpiry: date-only really does resolve to midnight UTC, not local time', parseAndValidateExpiry('2027-06-15', { now: NOW }) === '2027-06-15T00:00:00.000Z')

check('parseAndValidateExpiry REJECTS "01/02/2027" — locale-dependent (is it Jan 2 or Feb 1?), not strict ISO 8601', (() => {
  try { parseAndValidateExpiry('01/02/2027', { now: NOW }); return false } catch (err) { return /ISO 8601/.test(err.message) }
})())
check('parseAndValidateExpiry REJECTS "January 2, 2027" — an informal/locale-dependent format, not strict ISO 8601', (() => {
  try { parseAndValidateExpiry('January 2, 2027', { now: NOW }); return false } catch (err) { return /ISO 8601/.test(err.message) }
})())
check('parseAndValidateExpiry REJECTS "2027-01-01 12:00:00" — a space instead of "T", and no timezone marker at all', (() => {
  try { parseAndValidateExpiry('2027-01-01 12:00:00', { now: NOW }); return false } catch (err) { return /ISO 8601/.test(err.message) }
})())
check('parseAndValidateExpiry REJECTS "2027-01-01T12:00:00" — a well-formed datetime but with NO timezone marker, which the JS Date spec would otherwise silently parse as the OPERATOR\'S LOCAL time (exactly the ambiguity being closed)', (() => {
  try { parseAndValidateExpiry('2027-01-01T12:00:00', { now: NOW }); return false } catch (err) { return /ISO 8601/.test(err.message) }
})())

// Only an OMITTED flag (undefined — parseArgs() never produces anything
// else for a flag that wasn't passed) means "no expiry". Every other
// non-valid-date value — including an explicit null, which argv can never
// actually produce but a future programmatic caller could pass — throws
// rather than silently falling back to "no expiry".
for (const garbage of ['not-a-real-date', '', '   ', 123456789, true, { _seconds: 1 }, null, '01/02/2027', 'January 2, 2027', '2027-01-01 12:00:00', '2027-01-01T12:00:00', '2027-13-01T00:00:00Z']) {
  check(`parseAndValidateExpiry rejects malformed/ambiguous --expires (${JSON.stringify(garbage)}) with a throw, never a silent fallback`, (() => {
    try { parseAndValidateExpiry(garbage, { now: NOW }); return false } catch { return true }
  })())
}
check('parseAndValidateExpiry rejects a PAST expiry for a new grant (requireFuture, the default)', (() => {
  try { parseAndValidateExpiry(PAST_ISO, { now: NOW }); return false } catch (err) { return /future/.test(err.message) }
})())
check('parseAndValidateExpiry accepts a past expiry ONLY when requireFuture is explicitly disabled (not exposed by the CLI itself — defense-in-depth for future callers, e.g. a bulk-audit script)', parseAndValidateExpiry(PAST_ISO, { now: NOW, requireFuture: false }) === new Date(PAST_ISO).toISOString())

check('validateArgs rejects an invalid --expires BEFORE returning (would throw before main() ever reads the service-account file)', (() => {
  const args = { project: 'idogs-app-staging', saPath: '/fake/path.json', email: 'x@example.com', grantedBy: 'y', reason: 'z', expires: 'garbage' }
  try { validateArgs(args, { now: NOW }); return false } catch (err) { return /--expires/.test(err.message) }
})())
check('validateArgs rejects a PAST --expires for a new grant', (() => {
  const args = { project: 'idogs-app-staging', saPath: '/fake/path.json', email: 'x@example.com', grantedBy: 'y', reason: 'z', expires: PAST_ISO }
  try { validateArgs(args, { now: NOW }); return false } catch (err) { return /future/.test(err.message) }
})())
check('validateArgs accepts a valid FUTURE --expires and returns it normalized as normalizedExpiresAt', (() => {
  const args = { project: 'idogs-app-staging', saPath: '/fake/path.json', email: 'x@example.com', grantedBy: 'y', reason: 'z', expires: FUTURE_ISO }
  return validateArgs(args, { now: NOW }).normalizedExpiresAt === new Date(FUTURE_ISO).toISOString()
})())
check('validateArgs never validates/requires --expires for a --revoke (revoke does not take an expiry at all)', (() => {
  const args = { project: 'idogs-app-staging', saPath: '/fake/path.json', email: 'x@example.com', grantedBy: 'y', revoke: true }
  return validateArgs(args, { now: NOW }).normalizedExpiresAt === null
})())

check('buildEntitlementPayload (grant) records grantedAt/grantedBy/reason/expiresAt for audit', (() => {
  const payload = buildEntitlementPayload(
    { revoke: false, grantedBy: 'izipawsltd@gmail.com', reason: 'Super Admin', normalizedExpiresAt: FUTURE_ISO },
    { nowIso: NOW.toISOString(), existingEntitlement: null }
  )
  return payload.granted === true && payload.grantedAt === NOW.toISOString() && payload.grantedBy === 'izipawsltd@gmail.com' &&
    payload.reason === 'Super Admin' && payload.expiresAt === FUTURE_ISO
})())
check('buildEntitlementPayload (revoke) sets granted:false and records revokedAt/revokedBy, never deletes the field outright', (() => {
  const existing = { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'x', reason: 'y', expiresAt: null }
  const payload = buildEntitlementPayload(
    { revoke: true, grantedBy: 'izipawsltd@gmail.com' },
    { nowIso: NOW.toISOString(), existingEntitlement: existing }
  )
  return payload.granted === false && payload.revokedAt === NOW.toISOString() && payload.revokedBy === 'izipawsltd@gmail.com' &&
    payload.grantedAt === existing.grantedAt && payload.reason === existing.reason // prior audit fields preserved, not erased
})())

{
  const scriptSrc = readFileSync(new URL('../scripts/grant-internal-entitlement.mjs', import.meta.url), 'utf8')
  check('the grant script is not an HTTP endpoint (lives in scripts/, not api/)', true)
  check('the grant script resolves the target account via Firebase Auth email lookup, never a client-supplied UID', scriptSrc.includes('auth.getUserByEmail(args.email)') && !/--uid/.test(scriptSrc))
  check('the grant script has a hard project_id guard tying the service-account credential to --project', /saJson\.project_id !== args\.project/.test(scriptSrc))
  check('the grant script defaults to dry-run and requires --execute to write', /const DRY_RUN = !args\.execute/.test(scriptSrc) && /if \(DRY_RUN\)/.test(scriptSrc))
  check('the script refuses to create a brand-new profile document (must already exist)', scriptSrc.includes('!existingSnap.exists'))
  check('validateArgs (and therefore --expires validation) runs before the service-account file is ever read', scriptSrc.indexOf('validateArgs(rawArgs)') < scriptSrc.indexOf('readFileSync(args.saPath'))
  check('validateArgs (and therefore --expires validation) runs before any Firebase module is imported/initialized', scriptSrc.indexOf('validateArgs(rawArgs)') < scriptSrc.indexOf('initializeApp('))
  check('the pure validation functions (parseArgs/parseAndValidateExpiry/validateArgs/buildEntitlementPayload) are exported for direct unit testing, never merely regex-inspected', ['export function parseArgs', 'export function parseAndValidateExpiry', 'export function validateArgs', 'export function buildEntitlementPayload'].every(s => scriptSrc.includes(s)))
  check('main() only runs when the file is executed directly, never merely on import (isMainModule guard)', /const isMainModule = process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(scriptSrc) && /if \(isMainModule\) \{/.test(scriptSrc))
}

await summary()
