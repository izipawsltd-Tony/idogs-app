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

for (const legacyPlan of ['basic', 'pro', 'kennel', 'sms_addon', 'starter']) {
  await checkAsync(`retired legacy plan '${legacyPlan}' is rejected, not silently accepted`, async () => {
    const route = makeRoute()
    const res = await invoke(route, { authorization: 'Bearer valid-token', body: { plan: legacyPlan } })
    return res.statusCode === 400 && route.calls.sessions.length === 0
  })
}

const originalVercelEnv = process.env.VERCEL_ENV
const originalFirebaseProjectId = process.env.FIREBASE_PROJECT_ID
process.env.VERCEL_ENV = 'preview'
process.env.FIREBASE_PROJECT_ID = 'idogs-app-staging'
check(
  'exactly the two Plus plan keys are exposed and staging Preview resolves verified A$7/A$70 test prices',
  Object.keys(CHECKOUT_PRICE_IDS).length === 2 &&
    CHECKOUT_PRICE_IDS.plus_monthly === 'price_1U9YwuGHgBd6ZgJEX1Bdjz5x' &&
    CHECKOUT_PRICE_IDS.plus_annual === 'price_1U9ZPRGHgBd6ZgJEzFCtnfEK'
)
check(
  'isolated staging Preview resolves only verified iDogs A$7/A$70 test Plus prices',
  CHECKOUT_PRICE_IDS.plus_monthly === 'price_1U9YwuGHgBd6ZgJEX1Bdjz5x' &&
    CHECKOUT_PRICE_IDS.plus_annual === 'price_1U9ZPRGHgBd6ZgJEzFCtnfEK'
)
process.env.VERCEL_ENV = 'production'
process.env.FIREBASE_PROJECT_ID = 'idogs-app-staging'
check(
  'stable staging production target still resolves only verified iDogs A$7/A$70 test Plus prices',
  CHECKOUT_PRICE_IDS.plus_monthly === 'price_1U9YwuGHgBd6ZgJEX1Bdjz5x' &&
    CHECKOUT_PRICE_IDS.plus_annual === 'price_1U9ZPRGHgBd6ZgJEzFCtnfEK'
)
process.env.VERCEL_ENV = 'production'
process.env.FIREBASE_PROJECT_ID = 'idogs-app'
check(
  'production Firebase resolves current Stripe-verified iDogs A$7/A$70 live Plus prices',
  CHECKOUT_PRICE_IDS.plus_monthly === 'price_1UAInbGHgBd6ZgJE0NAikQgm' &&
    CHECKOUT_PRICE_IDS.plus_annual === 'price_1UAIngGHgBd6ZgJEh3njs6hZ'
)
if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
else process.env.VERCEL_ENV = originalVercelEnv
if (originalFirebaseProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID
else process.env.FIREBASE_PROJECT_ID = originalFirebaseProjectId

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
    params.line_items.length === 1
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
  'pastDueSince',
  'billingInterval',
  'scanPeriodAnchorDay',
  'plusScansUsed',
  'plusScansPeriodStart',
  'freeScansUsed',
  'lastKnownSubscriptionId',
  'subscriptionEventTimestamps',
  'plusScansSubscriptionId',
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
