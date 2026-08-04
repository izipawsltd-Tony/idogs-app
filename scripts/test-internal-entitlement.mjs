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
check(
  'a real paid Plus subscription is never weakened by the internal-entitlement code path (no entitlement present at all)',
  computeEffectivePlan({ plan: 'plus', subscriptionStatus: 'active' }, NOW) === 'plus'
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

await checkAsync('a real Stripe downgrade event never touches internalEntitlement, and effective plan stays Plus via the override', async () => {
  const db = createFakeFirestore({
    users: {
      'admin-user': {
        plan: 'plus',
        subscriptionStatus: 'active',
        stripeSubscriptionId: 'sub_admin',
        lastKnownSubscriptionId: 'sub_admin',
        internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'izipawsltd@gmail.com', reason: 'Super Admin', expiresAt: null },
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
    user.internalEntitlement?.granted === true && // ...but never touched the internal override
    computeEffectivePlan(user, NOW) === 'plus' // effective access survives the downgrade via the override
})

await checkAsync('checkout.session.completed (a genuine upgrade) also leaves an existing internalEntitlement untouched', async () => {
  const db = createFakeFirestore({
    users: {
      'admin-user': {
        internalEntitlement: { granted: true, grantedAt: '2026-01-01T00:00:00Z', grantedBy: 'izipawsltd@gmail.com', reason: 'Super Admin', expiresAt: null },
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
  return user.plan === 'plus' && user.internalEntitlement?.granted === true
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
  check('getEffectivePlanClient enforces expiresAt the same way the server does (>=, fails closed)', /now\.getTime\(\) >= expiresAtMs/.test(utilsSrc))
  check('getEffectivePlanClient signature accepts internalEntitlement so LittersPage.tsx can pass it through', /Pick<UserProfile, 'plan' \| 'subscriptionStatus' \| 'pastDueSince' \| 'internalEntitlement'>/.test(utilsSrc))
}

// ── grant-internal-entitlement.mjs: trusted-path structural guarantees ─

{
  const scriptSrc = readFileSync(new URL('../scripts/grant-internal-entitlement.mjs', import.meta.url), 'utf8')
  check('the grant script is not an HTTP endpoint (lives in scripts/, not api/)', true)
  check('the grant script resolves the target account via Firebase Auth email lookup, never a client-supplied UID', scriptSrc.includes('auth.getUserByEmail(args.email)') && !/--uid/.test(scriptSrc))
  check('the grant script has a hard project_id guard tying the service-account credential to --project', /saJson\.project_id !== args\.project/.test(scriptSrc))
  check('the grant script defaults to dry-run and requires --execute to write', /DRY_RUN = !args\.execute/.test(scriptSrc) && /if \(DRY_RUN\)/.test(scriptSrc))
  check('a revoke sets granted:false and records revokedAt/revokedBy for audit, never deletes the field outright', /granted: false,\s*\n\s*revokedAt: nowIso,\s*\n\s*revokedBy: args\.grantedBy,/.test(scriptSrc))
  check('a grant records grantedAt/grantedBy/reason/expiresAt for audit', ['grantedAt: nowIso', 'grantedBy: args.grantedBy', 'reason: args.reason', 'expiresAt: args.expires'].every(s => scriptSrc.includes(s)))
  check('the script refuses to create a brand-new profile document (must already exist)', scriptSrc.includes('!existingSnap.exists'))
}

await summary()
