// api/super-admin/ai-ceo.js — AI CEO OS v1 read-only decision kernel
//
// Phase 1 is intentionally deterministic and read-only. It turns trusted
// Super Admin platform data into a concise operating brief, explicit decision
// lanes, and approval gates without introducing a model provider, new secrets,
// Stripe writes, Firebase rule changes, or production-side automation.
import { getFirestore } from 'firebase-admin/firestore'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../_lib/entitlements.js'
import { getEstimatedMonthlyPrice } from './_pricing.js'
import { verifySuperAdmin } from './_auth.js'

function toDate(value) {
  if (!value) return new Date(0)
  if (typeof value.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

function percentage(numerator, denominator) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return

  try {
    const db = getFirestore()
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const usersSnap = await db.collection('users').get()
    const users = []
    usersSnap.forEach(doc => users.push({ id: doc.id, ...doc.data() }))

    let breeders = 0
    let owners = 0
    let activePaidSubscriptions = 0
    let plusEntitledAccounts = 0
    let internalEntitlementAccounts = 0
    let freeAccounts = 0
    let mrr = 0
    let newUsers7d = 0
    let newUsers30d = 0

    users.forEach(user => {
      if (user.role === 'owner') owners++
      else breeders++

      const effectivePlan = computeEffectivePlan(user, now)
      if (effectivePlan === 'plus') plusEntitledAccounts++
      else freeAccounts++

      if (hasValidInternalEntitlement(user, now)) internalEntitlementAccounts++

      if (
        user.subscriptionStatus === 'active' &&
        user.stripeSubscriptionId &&
        user.plan === 'plus'
      ) {
        activePaidSubscriptions++
        mrr += getEstimatedMonthlyPrice(user)
      }

      const createdAt = toDate(user.createdAt)
      if (createdAt >= sevenDaysAgo) newUsers7d++
      if (createdAt >= thirtyDaysAgo) newUsers30d++
    })

    const paidAccountShare = percentage(activePaidSubscriptions, users.length)
    const internalGrantShareOfPlus = percentage(internalEntitlementAccounts, plusEntitledAccounts)

    const decisions = []

    decisions.push({
      id: 'instrument-growth-baseline',
      lane: 'AUTO',
      priority: 1,
      title: 'Establish the weekly growth baseline',
      decision: 'Track acquisition, activation, paid conversion, retention and expansion as separate KPI stages before scaling paid marketing.',
      rationale: 'Current trusted data can measure users, paid subscriptions and estimated MRR, but not the complete acquisition-to-retention funnel.',
      owner: 'AI CEO / Growth',
      kpi: 'A complete weekly funnel with no unknown critical stage',
      reversible: true,
      financialApprovalRequired: false,
    })

    if (users.length > 0 && activePaidSubscriptions === 0) {
      decisions.push({
        id: 'activate-existing-users',
        lane: 'AUTO',
        priority: 2,
        title: 'Prioritise activation before increasing acquisition spend',
        decision: 'Audit the existing user journey and identify the shortest path from signup to first recurring paid value.',
        rationale: 'There are registered users but no active paid subscriptions in the trusted stored subscription fields.',
        owner: 'AI CEO / Product + Growth',
        kpi: 'First active paid subscriptions from the existing user base',
        reversible: true,
        financialApprovalRequired: false,
      })
    } else {
      decisions.push({
        id: 'improve-paid-share',
        lane: 'AUTO',
        priority: 2,
        title: 'Improve paid account share before adding fixed cost',
        decision: 'Review onboarding, Plus value communication and upgrade friction using existing users before adding material operating spend.',
        rationale: `Stored active paid accounts currently represent ${paidAccountShare}% of registered users. This is an account-share indicator, not a true funnel conversion rate.`,
        owner: 'AI CEO / Product + Growth',
        kpi: 'Higher active paid account share with stable support burden',
        reversible: true,
        financialApprovalRequired: false,
      })
    }

    decisions.push({
      id: 'protect-production-gate',
      lane: 'APPROVAL',
      priority: 3,
      title: 'Keep irreversible and production-risk actions behind Tony approval',
      decision: 'AI may research, diagnose, draft, prioritise and prepare Preview changes; production deploys, new material spend, contracts, pricing changes and sensitive financial actions remain blocked pending explicit approval.',
      rationale: 'This preserves the existing iDogs release discipline while increasing automation in reversible work.',
      owner: 'Tony / Financial Approval Gate',
      kpi: 'Zero unapproved production or financial-risk actions',
      reversible: false,
      financialApprovalRequired: true,
    })

    const watchItems = [
      {
        id: 'churn-history',
        severity: 'DATA_GAP',
        title: 'Churn and cohort retention are not yet measurable',
        reason: 'Historical cancellation/cohort data is not available in the current dashboard data model.',
      },
      {
        id: 'stripe-live-truth',
        severity: 'DATA_GAP',
        title: 'MRR is estimated from stored subscription fields',
        reason: 'This endpoint does not query live Stripe by design, so it must not be treated as a financial ledger.',
      },
      {
        id: 'funnel-traffic',
        severity: 'DATA_GAP',
        title: 'Traffic and acquisition-source data are outside the current trusted dataset',
        reason: 'True visitor → signup → activation conversion requires analytics instrumentation or an approved analytics source.',
      },
    ]

    const payload = {
      generatedAt: now.toISOString(),
      osVersion: '1.0.0-read-only',
      operatingMode: {
        name: 'READ_ONLY_DECISION_KERNEL',
        autonomousWritesEnabled: false,
        modelReasoningEnabled: false,
        description: 'Phase 1 converts trusted iDogs operating data into decisions and approval lanes. It performs no external writes or model-provider calls.',
      },
      objective: {
        northStar: 'Grow sustainable iDogs enterprise value and recurring free cash flow',
        constraints: ['Customer trust', 'Security', 'Liquidity', 'Legal/compliance', 'Tony approval rights'],
      },
      facts: {
        totalUsers: users.length,
        breeders,
        owners,
        newUsers7d,
        newUsers30d,
        activePaidSubscriptions,
        estimatedMrrAud: mrr,
        plusEntitledAccounts,
        internalEntitlementAccounts,
        freeAccounts,
        paidAccountSharePct: paidAccountShare,
        internalGrantShareOfPlusPct: internalGrantShareOfPlus,
      },
      brief: {
        status: activePaidSubscriptions > 0 ? 'OPERATING' : 'BUILDING_RECURRING_REVENUE',
        summary: activePaidSubscriptions > 0
          ? `iDogs has ${activePaidSubscriptions} stored active paid subscription${activePaidSubscriptions === 1 ? '' : 's'} and estimated MRR of A$${mrr}. The immediate CEO focus is improving measurement and paid account share without increasing irreversible cost.`
          : `iDogs has ${users.length} registered user${users.length === 1 ? '' : 's'} in the trusted user dataset but no stored active paid subscription. The immediate CEO focus is activation, measurement and first recurring revenue before material acquisition spend.`,
      },
      decisions: decisions.sort((a, b) => a.priority - b.priority),
      watchItems,
      approvalPolicy: {
        auto: ['Research', 'Analysis', 'KPI reporting', 'Draft marketing', 'Backlog prioritisation', 'Preview-safe implementation preparation'],
        approvalRequired: ['Production deployment', 'Material new spend', 'Contracts', 'Legal/tax decisions', 'Pricing changes', 'Stripe/Firebase production changes', 'Banking or money movement'],
      },
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error('AI CEO OS aggregation error:', error)
    return res.status(500).json({ error: 'Failed to compile AI CEO operating brief', message: error.message })
  }
}
