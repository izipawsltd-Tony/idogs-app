// api/super-admin/subscriptions.js — Read-only subscription & plan overview
//
// iDogs V1 has no formal `subscriptions` Firestore collection. This endpoint derives
// subscription status entirely from `users` profile fields (plan, subscriptionStatus,
// trialEndsAt, smsAddon, stripeSubscriptionId). No writes, no Stripe calls.
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { verifySuperAdmin } from './_auth.js'
import { SUPER_ADMIN_DATA_MODEL_NOTICE, SMS_ADDON_MONTHLY_PRICE, getPlanPrice } from './_pricing.js'

const PAID_PLANS = ['basic', 'pro', 'kennel']

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
      const plan = u.plan || 'trial'
      const smsAddon = u.smsAddon === true

      const accountName =
        u.kennelName ||
        u.displayName ||
        `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
        (u.email ? u.email.split('@')[0] : 'Unnamed account')

      // Trial status — only meaningful when plan === 'trial'
      let trialStatus = null
      let trialEndsAt = null
      if (plan === 'trial') {
        const parsedTrialEnd = u.trialEndsAt ? getSafeDate(u.trialEndsAt) : null
        trialEndsAt = parsedTrialEnd
        trialStatus = parsedTrialEnd ? (parsedTrialEnd > now ? 'active' : 'expired') : 'unknown'
      }

      // Subscription status — fall back to a derived label when the field is missing,
      // since iDogs V1 does not always write subscriptionStatus outside the Stripe webhook path.
      let subscriptionStatus = u.subscriptionStatus || null
      if (!subscriptionStatus) {
        if (plan === 'trial') subscriptionStatus = trialStatus === 'expired' ? 'trial_expired' : 'trialing'
        else if (plan === 'free') subscriptionStatus = 'free'
        else subscriptionStatus = 'unknown'
      }

      const hasStripeSubscription = !!u.stripeSubscriptionId
      const isActivePaid = subscriptionStatus === 'active' && PAID_PLANS.includes(plan) && hasStripeSubscription

      const estimatedMonthlyValue = PAID_PLANS.includes(plan)
        ? getPlanPrice(plan) + (smsAddon ? SMS_ADDON_MONTHLY_PRICE : 0)
        : 0

      const createdDate = authMeta && authMeta.creationTime ? new Date(authMeta.creationTime) : getSafeDate(u.createdAt)

      return {
        uid,
        accountName,
        email: u.email || 'No email',
        role,
        plan,
        subscriptionStatus,
        trialStatus,
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
        smsAddon,
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
    const trialAccounts = subscriptions.filter(s => s.plan === 'trial').length
    const activePaidAccounts = subscriptions.filter(s => s.isActivePaid).length
    const freeAccounts = subscriptions.filter(s => s.plan === 'free').length
    const smsAddonAccounts = subscriptions.filter(s => s.smsAddon).length
    const estimatedMrr = subscriptions.reduce((sum, s) => sum + (s.isActivePaid ? s.estimatedMonthlyValue : 0), 0)

    return res.status(200).json({
      subscriptions,
      summary: {
        totalAccounts,
        trialAccounts,
        activePaidAccounts,
        freeAccounts,
        smsAddonAccounts,
        estimatedMrr,
      },
      dataModelNotice: SUPER_ADMIN_DATA_MODEL_NOTICE,
    })
  } catch (error) {
    console.error('Failed to compile subscriptions overview:', error)
    return res.status(500).json({ error: 'Failed to compile subscriptions overview', message: error.message })
  }
}
