// api/super-admin/dashboard.js — Secure Super Admin Dashboard Aggregate API
import { getFirestore } from 'firebase-admin/firestore'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../_lib/entitlements.js'
import { getEstimatedMonthlyPrice } from './_pricing.js'
import { verifySuperAdmin } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return // verifySuperAdmin already sent 401/403

  try {
    const db = getFirestore()

    // 2. Fetch Users Data for KPI aggregates, plan distributions, and recent signups
    const usersSnap = await db.collection('users').get()
    const usersList = []

    usersSnap.forEach(doc => {
      usersList.push({ id: doc.id, ...doc.data() })
    })

    // Calculate user & organization metrics
    let totalUsers = usersList.length
    let totalBreeders = 0
    let totalOwners = 0

    usersList.forEach(u => {
      if (u.role === 'owner') {
        totalOwners++
      } else {
        // default to breeder for any other or unspecified role
        totalBreeders++
      }
    })

    const now = new Date()
    let activePaidSubscriptions = 0
    let mrrValue = 0
    let plusEntitledAccounts = 0
    let internalEntitlementAccounts = 0
    let freeAccounts = 0

    usersList.forEach(u => {
      const plan = computeEffectivePlan(u, now)
      if (plan === 'plus') plusEntitledAccounts++
      else freeAccounts++
      if (hasValidInternalEntitlement(u, now)) internalEntitlementAccounts++

      // Determine Active Paid Subscriptions and MRR
      // Narrowest definition: subscriptionStatus is active, stripeSubscriptionId exists,
      // and plan is one of the paid ones.
      const hasActivePaidStatus = u.subscriptionStatus === 'active'
      const hasSubscriptionId = !!u.stripeSubscriptionId
      if (hasActivePaidStatus && hasSubscriptionId && u.plan === 'plus') {
        activePaidSubscriptions++
        mrrValue += getEstimatedMonthlyPrice(u)
      }
    })

    // Sort and compile recent signups (limit 10, safe fields only)
    const getSafeDate = (val) => {
      if (!val) return new Date(0)
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    const sortedUsers = [...usersList].sort((a, b) => {
      const dateA = getSafeDate(a.createdAt)
      const dateB = getSafeDate(b.createdAt)
      return dateB.getTime() - dateA.getTime()
    })

    const recentSignups = sortedUsers.slice(0, 10).map(u => ({
      uid: u.id,
      email: u.email || 'No email',
      role: u.role || 'breeder',
      plan: computeEffectivePlan(u, now),
      createdAt: getSafeDate(u.createdAt).toISOString()
    }))

    // 3. Fetch Recent Platform Activity from auditLogs
    let recentActivity = []
    try {
      const auditSnap = await db.collection('auditLogs')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get()

      auditSnap.forEach(doc => {
        const d = doc.data()
        const createdAtDate = getSafeDate(d.createdAt)
        recentActivity.push({
          id: doc.id,
          action: d.action || '',
          details: d.details || '',
          performedByEmail: d.performedByEmail || d.performed || 'System',
          createdAt: createdAtDate.toISOString()
        })
      })
    } catch (auditErr) {
      console.error('Audit logs query error:', auditErr.message)
      // If audit logs query fails (e.g. index build or empty database), degrade gracefully
    }

    // 4. Compile response data
    const payload = {
      generatedAt: now.toISOString(),
      metrics: {
        totalOrganisations: totalBreeders, // 1 breeder = 1 tenant/org
        totalUsers,
        breakdown: {
          breeders: totalBreeders,
          owners: totalOwners
        },
        activeSubscriptions: activePaidSubscriptions,
        mrr: mrrValue,
        plusEntitledAccounts,
        internalEntitlementAccounts,
        freeAccounts,
        churnRate: null // Honestly marked not available
      },
      recentSignups,
      recentActivity,
      systemStatus: {
        apiStatus: 'reachable',
        authStatus: 'verified',
        dataQueryStatus: 'completed'
      },
      limitations: {
        mrr: 'MRR is estimated from stored Plus subscription fields and billing interval, not a live Stripe lookup.',
        churnRate: 'Churn rate is unavailable because historical cancellation/cohort data is not stored.',
        systemStatus: 'System status only reflects this dashboard request, not full infrastructure monitoring.',
        authTesting: 'Full manual auth testing still needs staging QA for valid admin and valid non-admin accounts.'
      }
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error('Dashboard API aggregation error:', error)
    return res.status(500).json({ error: 'Failed to compile dashboard metrics', message: error.message })
  }
}
