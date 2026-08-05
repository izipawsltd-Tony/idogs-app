import { readFileSync } from 'node:fs'
import { createCheckoutHandler, CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res },
    json(body) { res.body = body; return res },
  }
  return res
}

function makeRoute({
  identity = { uid: 'verified-uid', email: 'verified@example.com' },
  tokenError = null,
} = {}) {
  const calls = { tokens: [], sessions: [] }
  const handler = createCheckoutHandler({
    getAppUrl: () => 'https://idogs.com.au',
    verifyIdToken: async token => {
      calls.tokens.push(token)
      if (tokenError) throw tokenError
      return identity
    },
    createSession: async params => {
      calls.sessions.push(params)
      return { url: 'https://checkout.stripe.test/session' }
    },
  })
  return { handler, calls }
}

async function invoke(route, {
  authorization,
  body = { plan: 'plus_monthly' },
} = {}) {
  const res = makeRes()
  await route.handler({
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body,
  }, res)
  return res
}

await checkAsync('unauthenticated Checkout is rejected without calling Stripe', async () => {
  const route = makeRoute()
  const res = await invoke(route)
  return res.statusCode === 401 && route.calls.sessions.length === 0
})

await checkAsync('invalid Firebase token is rejected without calling Stripe', async () => {
  const route = makeRoute({ tokenError: new Error('invalid token') })
  const res = await invoke(route, { authorization: 'Bearer invalid-token' })
  return res.statusCode === 401 && route.calls.tokens[0] === 'invalid-token' && route.calls.sessions.length === 0
})

await checkAsync('request-body userId cannot override verified identity', async () => {
  const route = makeRoute()
  const res = await invoke(route, {
    authorization: 'Bearer valid-token',
    body: { plan: 'plus_monthly', userId: 'attacker-selected-uid' },
  })
  return res.statusCode === 403 && route.calls.sessions.length === 0
})

await checkAsync('request-body email cannot override verified identity', async () => {
  const route = makeRoute()
  const res = await invoke(route, {
    authorization: 'Bearer valid-token',
    body: { plan: 'plus_monthly', userEmail: 'victim@example.com' },
  })
  return res.statusCode === 403 && route.calls.sessions.length === 0
})

await checkAsync('unsupported plan remains rejected', async () => {
  const route = makeRoute()
  const res = await invoke(route, {
    authorization: 'Bearer valid-token',
    body: { plan: 'attacker-price' },
  })
  return res.statusCode === 400 && route.calls.sessions.length === 0
})

// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md, LOCKED): the
// legacy basic/pro/kennel/sms_addon four-tier prices are retired — none
// of them should be selectable through this endpoint anymore.
for (const legacyPlan of ['basic', 'pro', 'kennel', 'sms_addon', 'starter']) {
  await checkAsync(`retired legacy plan '${legacyPlan}' is rejected, not silently accepted`, async () => {
    const route = makeRoute()
    const res = await invoke(route, { authorization: 'Bearer valid-token', body: { plan: legacyPlan } })
    return res.statusCode === 400 && route.calls.sessions.length === 0
  })
}

check(
  'exactly the two Plus price ids are allowlisted — no $40 launch-offer price, no legacy tiers',
  Object.keys(CHECKOUT_PRICE_IDS).length === 2 &&
    CHECKOUT_PRICE_IDS.plus_monthly === 'price_1TwZZL5lmfxrCiH3IeSldxni' &&
    CHECKOUT_PRICE_IDS.plus_annual === 'price_1TwZa25lmfxrCiH3L1PL7jMd'
)

await checkAsync('authenticated Checkout (monthly) uses only server-derived customer and metadata identity, and grants no trial', async () => {
  const route = makeRoute()
  const res = await invoke(route, {
    authorization: 'Bearer valid-token',
    body: {
      plan: 'plus_monthly',
      userId: 'verified-uid',
      userEmail: 'VERIFIED@example.com',
    },
  })
  const params = route.calls.sessions[0]
  return res.statusCode === 200 &&
    route.calls.sessions.length === 1 &&
    params.customer_email === 'verified@example.com' &&
    params.metadata.userId === 'verified-uid' &&
    params.metadata.plan === 'plus' &&
    params.metadata.interval === 'monthly' &&
    params.subscription_data.metadata.userId === 'verified-uid' &&
    params.subscription_data.metadata.plan === 'plus' &&
    params.subscription_data.trial_period_days === undefined &&
    params.line_items[0].price === CHECKOUT_PRICE_IDS.plus_monthly
})

await checkAsync('authenticated Checkout (annual) selects the annual price and interval metadata', async () => {
  const route = makeRoute()
  const res = await invoke(route, { authorization: 'Bearer valid-token', body: { plan: 'plus_annual' } })
  const params = route.calls.sessions[0]
  return res.statusCode === 200 &&
    params.metadata.interval === 'annual' &&
    params.line_items[0].price === CHECKOUT_PRICE_IDS.plus_annual &&
    params.line_items.length === 1 // no sms_addon line item exists anymore
})

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const dbSource = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const billingUiSource = readFileSync(new URL('../src/pages/BillingPage.tsx', import.meta.url), 'utf8')
const protectedFields = [
  'plan',
  'subscriptionStatus',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'trialEndsAt',
  'planActivatedAt',
  // iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md) additions —
  // server-owned by api/stripe-webhook.js / api/enforce-billing-grace.js /
  // api/scan.js. A client that could set freeScansUsed/plusScansUsed
  // downward, or plan to 'plus' directly, would defeat quota enforcement
  // entirely.
  'pastDueSince',
  'billingInterval',
  'scanPeriodAnchorDay',
  'plusScansUsed',
  'plusScansPeriodStart',
  'freeScansUsed',
  // Codex H5 — out-of-order Stripe event ownership tracking.
  'lastKnownSubscriptionId',
  'subscriptionEventTimestamps',
  // Codex H1 (round 4) — quota-initialization ownership marker.
  'plusScansSubscriptionId',
  // Internal Super Admin entitlement (api/_lib/entitlements.js) — an
  // admin-granted Plus override independent of Stripe. See
  // scripts/test-internal-entitlement.mjs for the full behavioral suite;
  // this file only needs the same protected-field/strip checks every
  // other billing field already gets below.
  'internalEntitlement',
]

for (const field of protectedFields) {
  check(`Firestore protected-field set includes ${field}`, rules.includes(`'${field}'`))
}

check(
  'user creates reject every protected billing field',
  /allow create: if isOwnerUser\(userId\) &&\s*!request\.resource\.data\.keys\(\)\.hasAny\(userBillingFields\(\)\);/s.test(rules),
)
check(
  'user updates reject adding, changing, or removing protected billing fields',
  /allow update: if isOwnerUser\(userId\) &&\s*!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\s*\.hasAny\(userBillingFields\(\)\);/s.test(rules),
)
check(
  'client deletion cannot remove trusted billing fields',
  /allow delete: if isOwnerUser\(userId\) &&\s*!resource\.data\.keys\(\)\.hasAny\(userBillingFields\(\)\);/s.test(rules),
)
check(
  'ordinary owner profile updates remain permitted through the protected-field diff gate',
  rules.includes('allow update: if isOwnerUser(userId) &&'),
)
check(
  "another user's document remains protected by exact UID ownership",
  rules.includes('return isSignedIn() && request.auth.uid == userId;'),
)
check(
  'browser signup strips billing-owned fields and no longer initializes plan/trial state',
  protectedFields.every(field => dbSource.includes(`${field}: _`)) &&
    !/plan:\s*'trial'/.test(dbSource.slice(dbSource.indexOf('export async function createUserProfile'), dbSource.indexOf('export async function updateUserProfile'))),
)
check(
  'Billing UI sends a Firebase ID token and no browser identity fields',
  billingUiSource.includes('await user.getIdToken()') &&
    billingUiSource.includes('Authorization: `Bearer ${idToken}`') &&
    !billingUiSource.includes('userId: user.uid') &&
    !billingUiSource.includes('userEmail: user.email'),
)

await summary()
