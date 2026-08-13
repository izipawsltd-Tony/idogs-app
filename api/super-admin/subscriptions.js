// api/super-admin/subscriptions.js — Read-only subscription & plan overview
//
// iDogs V1 has no formal `subscriptions` Firestore collection. This endpoint derives
// subscription status entirely from trusted `users` profile billing fields.
// No writes and no live Stripe calls.
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { verifySuperAdmin } from './_auth.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../_lib/entitlements.js'
import { SUPER_ADMIN_DATA_MODEL_NOTICE, getEstimatedMonthlyPrice } from './_pricing.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return

  try {
    const db = getFirestore()
    const auth = getAuth()

    // 2. Fetch users and Auth metadata in parallel (read-only)
    const [usersSnap, authUsersSnap] = await Promise.all([
      db.collection('users').get(),
      auth.listUsers(1000),
    ])

    const authUsersMap = {}
    authUsersSnap.users.forEach(u => {
      authUsersMap[u.uid] = {
        lastSignInTime: u.metadata.lastSignInTime || null,
        creationTime: u.metadata.creationTime || null,
      }
    })

    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    const now = new Date()
    const usersList = []
    usersSnap.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }))

    // 3. Derive a subscription row per user profile
    const subscriptions = usersList.map(u => {
      const uid = u.id
      const authMeta = authUsersMap[uid] || null
      const role = u.role || 'breeder'
      const plan = computeEffectivePlan(u, now)
      const billingInterval = u.billingInterval === 'annual' ? 'annual' : (plan === 'plus' ? 'monthly' : null)
      const internalEntitlement = hasValidInternalEntitlement(u, now)

      const accountName =
        u.kennelName ||
        u.displayName ||
        `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
        (u.email ? u.email.split('@')[0] : 'Unnamed account')

      // Subscription status — fall back to a derived label when the field is missing,
      // while keeping internal grants visibly distinct from paid subscriptions.
      let subscriptionStatus = u.subscriptionStatus || null
      if (!subscriptionStatus) {
        if (internalEntitlement) subscriptionStatus = 'internal'
        else if (plan === 'free') subscriptionStatus = 'free'
        else subscriptionStatus = 'unknown'
      }

      const hasStripeSubscription = !!u.stripeSubscriptionId
      const isActivePaid = ['active', 'past_due'].includes(subscriptionStatus) && plan === 'plus' && hasStripeSubscription

      const estimatedMonthlyValue = isActivePaid ? getEstimatedMonthlyPrice(u) : 0

      const createdDate = authMeta && authMeta.creationTime ? new Date(authMeta.creationTime) : getSafeDate(u.createdAt)

      return {
        uid,
        accountName,
        email: u.email || 'No email',
        role,
        plan,
        subscriptionStatus,
        billingInterval,
        internalEntitlement,
        estimatedMonthlyValue,
        isActivePaid,
        registeredAt: createdDate ? createdDate.toISOString() : null,
        lastSignInTime: authMeta && authMeta.lastSignInTime ? new Date(authMeta.lastSignInTime).toISOString() : null,
      }
    })

    subscriptions.sort((a, b) => {
      const timeA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0
      const timeB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0
      return timeB - timeA
    })

    // 4. Compile summary aggregates
    const totalAccounts = subscriptions.length
    const activePaidAccounts = subscriptions.filter(s => s.isActivePaid).length
    const freeAccounts = subscriptions.filter(s => s.plan === 'free').length
    const plusAccounts = subscriptions.filter(s => s.plan === 'plus').length
    const internalEntitlementAccounts = subscriptions.filter(s => s.internalEntitlement).length
    const estimatedMrr = subscriptions.reduce((sum, s) => sum + (s.isActivePaid ? s.estimatedMonthlyValue : 0), 0)

    return res.status(200).json({
      subscriptions,
      summary: {
        totalAccounts,
        activePaidAccounts,
        freeAccounts,
        plusAccounts,
        internalEntitlementAccounts,
        estimatedMrr,
      },
      dataModelNotice: SUPER_ADMIN_DATA_MODEL_NOTICE,
    })
  } catch (error) {
    console.error('Failed to compile subscriptions overview:', error)
    return res.status(500).json({ error: 'Failed to compile subscriptions overview', message: error.message })
  }
}
