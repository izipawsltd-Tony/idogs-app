// api/super-admin/plans-pricing.js — Read-only plan catalogue & usage overview
//
// Read-only. No Stripe calls, no price IDs, no plan/pricing writes. The catalogue in
// ./_pricing.js is a Super Admin display-only mirror of BillingPage.tsx pricing.
import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { SUPER_ADMIN_DATA_MODEL_NOTICE, SMS_ADDON_MONTHLY_PRICE, SUPER_ADMIN_PLAN_CATALOGUE } from './_pricing.js'

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
    const usersSnap = await db.collection('users').get()

    const usersList = []
    usersSnap.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }))

    // 2. Build a usage row per catalogue plan
    const plans = SUPER_ADMIN_PLAN_CATALOGUE.map(planMeta => {
      const accountsOnPlan = usersList.filter(u => (u.plan || 'trial') === planMeta.id)

      // Only count MRR contribution for accounts that look like a genuinely active paid
      // subscription (mirrors the same definition used by /api/super-admin/subscriptions).
      const activePaidAccounts = accountsOnPlan.filter(
        u => PAID_PLANS.includes(planMeta.id) && u.subscriptionStatus === 'active' && !!u.stripeSubscriptionId
      )

      const estimatedMrrContribution = activePaidAccounts.reduce((sum, u) => {
        return sum + planMeta.price + (u.smsAddon === true ? SMS_ADDON_MONTHLY_PRICE : 0)
      }, 0)

      return {
        id: planMeta.id,
        name: planMeta.name,
        estimatedMonthlyPrice: planMeta.price,
        description: planMeta.description,
        accountsCount: accountsOnPlan.length,
        activePaidAccountsCount: activePaidAccounts.length,
        estimatedMrrContribution,
        status: 'display-only',
      }
    })

    const smsAddonAccounts = usersList.filter(u => u.smsAddon === true)
    const totalAccounts = usersList.length
    const estimatedTotalMrr = plans.reduce((sum, p) => sum + p.estimatedMrrContribution, 0)

    return res.status(200).json({
      plans,
      summary: {
        totalAccounts,
        estimatedTotalMrr,
        smsAddonAccounts: smsAddonAccounts.length,
        smsAddonEstimatedMonthly: smsAddonAccounts.length * SMS_ADDON_MONTHLY_PRICE,
      },
      dataModelNotice: SUPER_ADMIN_DATA_MODEL_NOTICE,
    })
  } catch (error) {
    console.error('Failed to compile plans & pricing overview:', error)
    return res.status(500).json({ error: 'Failed to compile plans & pricing overview', message: error.message })
  }
}
