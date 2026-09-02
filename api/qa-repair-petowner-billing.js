import crypto from 'node:crypto'
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createBillingSummaryHandler } from './_lib/billing-handler.js'

const STAGING_FIREBASE_PROJECT_ID = 'idogs-app-staging'
const STAGING_VERCEL_PROJECT_ID = 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o'
const TARGET_EMAIL_SHA256 = 'edb3deb42b3a310b28c1c5741b7a85b360997ae1f3c3907cbfe19484d168c8a5'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const auth = getAuth()
const db = getFirestore()

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function findTargetUser() {
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users || []) {
      const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
      if (email && sha256(email) === TARGET_EMAIL_SHA256) return user
    }
    pageToken = page.pageToken
  } while (pageToken)
  return null
}

async function isResourceMissing(read) {
  try {
    await read()
    return false
  } catch (error) {
    if (error?.code === 'resource_missing') return true
    throw error
  }
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function qaBillingSummary(uid) {
  const handler = createBillingSummaryHandler({
    verifyIdToken: async () => ({ uid }),
    getProfile: async userId => {
      const snap = await db.collection('users').doc(userId).get()
      return snap.exists ? snap.data() : null
    },
    retrieveSubscription: async () => { throw new Error('REPAIR_QA_UNEXPECTED_SUBSCRIPTION_LOOKUP') },
    listInvoices: async () => { throw new Error('REPAIR_QA_UNEXPECTED_INVOICE_LOOKUP') },
    isSmsConfigured: () => Boolean(process.env.STRIPE_SMS_ADDON_PRICE_ID),
  })
  const req = { method: 'GET', headers: { authorization: 'Bearer one-shot-repair' } }
  const res = fakeResponse()
  await handler(req, res)
  return res
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.VERCEL_PROJECT_ID !== STAGING_VERCEL_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID !== STAGING_FIREBASE_PROJECT_ID ||
    !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
  ) {
    return res.status(404).json({ error: 'Not found' })
  }

  try {
    const user = await findTargetUser()
    if (!user?.uid) return res.status(404).json({ error: 'Target not found' })

    const userRef = db.collection('users').doc(user.uid)
    const beforeSnap = await userRef.get()
    if (!beforeSnap.exists) return res.status(404).json({ error: 'Profile not found' })
    const before = beforeSnap.data() || {}

    const customerId = typeof before.stripeCustomerId === 'string' ? before.stripeCustomerId : ''
    const subscriptionId = typeof before.stripeSubscriptionId === 'string' ? before.stripeSubscriptionId : ''

    if (!customerId && !subscriptionId && before.plan !== 'plus') {
      const qa = await qaBillingSummary(user.uid)
      return res.status(200).json({
        ok: qa.statusCode === 200,
        repaired: false,
        alreadyRepaired: true,
        billingQa: {
          status: qa.statusCode,
          plan: qa.body?.entitlement?.plan || null,
          canManageBilling: qa.body?.canManageBilling === true,
          smsStatus: qa.body?.sms?.status || null,
        },
        dogsTouched: false,
        littersTouched: false,
      })
    }

    if (before.plan !== 'plus' || before.subscriptionStatus !== 'active' || !customerId || !subscriptionId) {
      return res.status(409).json({ error: 'Unexpected target billing state' })
    }

    const [customerMissing, subscriptionMissing] = await Promise.all([
      isResourceMissing(() => stripe.customers.retrieve(customerId)),
      isResourceMissing(() => stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })),
    ])

    if (!customerMissing || !subscriptionMissing) {
      return res.status(409).json({ error: 'Stripe linkage is not safely stale' })
    }

    const repairAt = new Date().toISOString()
    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef)
      if (!snap.exists) throw new Error('REPAIR_PROFILE_DISAPPEARED')
      const current = snap.data() || {}
      if (
        current.plan !== 'plus' ||
        current.subscriptionStatus !== 'active' ||
        current.stripeCustomerId !== customerId ||
        current.stripeSubscriptionId !== subscriptionId
      ) {
        throw new Error('REPAIR_STATE_CHANGED')
      }

      tx.update(userRef, {
        plan: 'free',
        subscriptionStatus: FieldValue.delete(),
        billingInterval: FieldValue.delete(),
        stripeCustomerId: FieldValue.delete(),
        stripeSubscriptionId: FieldValue.delete(),
        lastKnownSubscriptionId: FieldValue.delete(),
        plusScansSubscriptionId: FieldValue.delete(),
        plusScansUsed: FieldValue.delete(),
        plusScansPeriodStart: FieldValue.delete(),
        planActivatedAt: FieldValue.delete(),
        scanPeriodAnchorDay: FieldValue.delete(),
        pastDueSince: FieldValue.delete(),
        trialEndsAt: FieldValue.delete(),
        smsAddonStatus: 'inactive',
        smsStripeSubscriptionId: FieldValue.delete(),
        smsStripePriceId: FieldValue.delete(),
        smsPeriodStart: FieldValue.delete(),
        smsPeriodEnd: FieldValue.delete(),
        smsCreditsUsed: 0,
        smsLastBillingEventAt: repairAt,
        billingRepairAt: repairAt,
        billingRepairReason: 'stale_test_stripe_linkage_resource_missing',
      })
    })

    const afterSnap = await userRef.get()
    const after = afterSnap.data() || {}
    if (
      after.plan !== 'free' ||
      typeof after.stripeCustomerId === 'string' ||
      typeof after.stripeSubscriptionId === 'string' ||
      after.smsAddonStatus !== 'inactive'
    ) {
      throw new Error('REPAIR_POSTCONDITION_FAILED')
    }

    const qa = await qaBillingSummary(user.uid)
    const qaPass =
      qa.statusCode === 200 &&
      qa.body?.subscription === null &&
      Array.isArray(qa.body?.invoices) && qa.body.invoices.length === 0 &&
      qa.body?.canManageBilling === false &&
      qa.body?.entitlement?.plan === 'free' &&
      qa.body?.entitlement?.billingInterval === null &&
      qa.body?.entitlement?.subscriptionStatus === null &&
      qa.body?.sms?.status === 'inactive'

    if (!qaPass) throw new Error('REPAIR_BILLING_QA_FAILED')

    return res.status(200).json({
      ok: true,
      repaired: true,
      stripeMissingVerified: { customer: true, subscription: true },
      billingQa: { status: 200, plan: 'free', canManageBilling: false, smsStatus: 'inactive' },
      dogsTouched: false,
      littersTouched: false,
    })
  } catch (error) {
    console.error('qa-repair-petowner-billing: failed', { code: error?.message || error?.code || 'REPAIR_FAILED' })
    return res.status(500).json({ error: 'Repair failed' })
  }
}
