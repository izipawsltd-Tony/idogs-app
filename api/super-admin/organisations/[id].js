// api/super-admin/organisations/[id].js — Get details for a single organisation
import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from '../_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return 

  const { id } = req.query
  if (!id) {
    return res.status(400).json({ error: 'Organisation ID (uid) required' })
  }

  try {
    const db = getFirestore()

    // 2. Fetch breeder user document
    const userDoc = await db.collection('users').doc(id).get()
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Organisation not found' })
    }

    const userData = userDoc.data()
    // Explicitly enforce that this is a breeder account
    if (userData.role !== 'breeder') {
      return res.status(403).json({ error: 'Forbidden: Account is not a Breeder organisation' })
    }

    // 3. Fetch dogs and litters in parallel (where tenantId === id)
    const [dogsSnap, littersSnap] = await Promise.all([
      db.collection('dogs').where('tenantId', '==', id).get(),
      db.collection('litters').where('tenantId', '==', id).get()
    ])

    const dogs = []
    dogsSnap.forEach(doc => {
      dogs.push({ id: doc.id, ...doc.data() })
    })

    const litters = []
    littersSnap.forEach(doc => {
      litters.push({ id: doc.id, ...doc.data() })
    })

    // 4. Fetch recent audit logs from two separate source filters and merge in memory (avoids OR index issues)
    const [logsByTenantSnap, logsByEmailSnap] = await Promise.all([
      db.collection('auditLogs').where('tenantId', '==', id).limit(100).get(),
      db.collection('auditLogs').where('performedByEmail', '==', userData.email || '').limit(100).get()
    ])

    const logsMap = new Map()
    const getSafeDate = (val) => {
      if (!val) return new Date(0)
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    const addLogToMap = (doc) => {
      const d = doc.data()
      const createdAtDate = getSafeDate(d.createdAt)
      logsMap.set(doc.id, {
        id: doc.id,
        action: d.action || '',
        details: d.details || '',
        performedByEmail: d.performedByEmail || d.performed || 'System',
        createdAt: createdAtDate.toISOString()
      })
    }

    logsByTenantSnap.forEach(addLogToMap)
    logsByEmailSnap.forEach(addLogToMap)

    // Sort logs in memory by createdAt descending
    const recentActivity = Array.from(logsMap.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }).slice(0, 20)

    // 5. Calculate metrics
    const activeDogs = dogs.filter(d => d.status !== 'transferred' && !d.isDeceased)
    
    let puppiesCount = 0
    litters.forEach(l => {
      if (Array.isArray(l.puppyIds)) {
        puppiesCount += l.puppyIds.length
      }
    })

    // Compute estimated MRR using same pricing logic as dashboard
    const PLAN_PRICES = {
      basic: 5,
      pro: 12,
      kennel: 29
    }
    const plan = userData.plan || 'trial'
    const hasActivePaidStatus = userData.subscriptionStatus === 'active'
    const hasSubscriptionId = !!userData.stripeSubscriptionId
    const isPaidPlan = plan in PLAN_PRICES

    let estimatedMrr = 0
    if (hasActivePaidStatus && hasSubscriptionId && isPaidPlan) {
      estimatedMrr = PLAN_PRICES[plan] || 0
      if (userData.smsAddon === true) {
        estimatedMrr += 3
      }
    }

    const createdDate = getSafeDate(userData.createdAt)

    const payload = {
      organisation: {
        id,
        name: userData.kennelName || userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || (userData.email ? userData.email.split('@')[0] : 'Unnamed Breeder'),
        email: userData.email || 'No email',
        plan,
        status: userData.subscriptionStatus || (plan === 'trial' ? 'Trial' : 'Active'),
        createdAt: createdDate ? createdDate.toISOString() : null,
        state: userData.state || null,
        phone: userData.phone || null,
        estimatedMrr,
        dogsCount: activeDogs.length,
        littersCount: litters.length,
        puppiesCount,
        recentActivity,
        dogs: dogs.map(d => ({
          id: d.id,
          name: d.name,
          breed: d.breed,
          sex: d.sex,
          dateOfBirth: d.dateOfBirth,
          lifeStage: d.lifeStage,
          isDeceased: d.isDeceased || false,
          status: d.status || 'active'
        })),
        litters: litters.map(l => ({
          id: l.id,
          name: l.name,
          actualBirthDate: l.actualBirthDate || l.expectedDueDate || null,
          puppiesCount: Array.isArray(l.puppyIds) ? l.puppyIds.length : 0
        }))
      },
      limitations: {
        note: 'This report is computed in-memory on demand and uses V1 tenant mapping assumptions.',
        mrr: 'MRR is estimated from database status flags and configured pricing. No live Stripe lookups are made.'
      }
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error(`Failed to get organisation ${id}:`, error)
    return res.status(500).json({ error: 'Failed to get organisation details', message: error.message })
  }
}
