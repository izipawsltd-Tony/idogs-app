// api/super-admin/users/[uid].js — Get details for a single user
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { verifySuperAdmin } from '../_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return 

  const { uid } = req.query
  if (!uid) {
    return res.status(400).json({ error: 'User UID required' })
  }

  try {
    const db = getFirestore()
    const auth = getAuth()

    // 2. Fetch Firestore profile and Firebase Auth account in parallel
    let profileData = null
    let authData = null

    const profileDoc = await db.collection('users').doc(uid).get()
    if (profileDoc.exists) {
      profileData = profileDoc.data()
    }

    try {
      authData = await auth.getUser(uid)
    } catch (authErr) {
      console.warn(`User UID ${uid} not found in Firebase Auth:`, authErr.message)
    }

    // 3. If neither exists, user is not found
    if (!profileData && !authData) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Determine values with appropriate fallbacks
    const email = profileData?.email || authData?.email || 'No email'
    const role = profileData?.role || 'breeder'
    const plan = profileData?.plan || 'trial'
    const isOwner = role === 'owner'

    // 4. Fetch associated dogs, litters, and audit logs
    const [dogsByTenantSnap, dogsByOwnerSnap, littersSnap] = await Promise.all([
      db.collection('dogs').where('tenantId', '==', uid).get(),
      db.collection('dogs').where('currentOwnerId', '==', uid).get(),
      db.collection('litters').where('tenantId', '==', uid).get()
    ])

    // Merge and deduplicate dogs in memory
    const dogsMap = new Map()
    const addDogToMap = (doc) => {
      const d = doc.data()
      dogsMap.set(doc.id, {
        id: doc.id,
        name: d.name,
        breed: d.breed,
        sex: d.sex,
        dateOfBirth: d.dateOfBirth,
        lifeStage: d.lifeStage,
        isDeceased: d.isDeceased || false,
        status: d.status || 'active',
        tenantId: d.tenantId || null,
        currentOwnerId: d.currentOwnerId || null
      })
    }
    dogsByTenantSnap.forEach(addDogToMap)
    dogsByOwnerSnap.forEach(addDogToMap)
    const dogs = Array.from(dogsMap.values())

    const litters = []
    littersSnap.forEach(doc => {
      litters.push({ id: doc.id, ...doc.data() })
    })

    // Fetch and merge audit logs in memory (avoiding composite index orderBy rules)
    const [logsByTenantSnap, logsByEmailSnap] = await Promise.all([
      db.collection('auditLogs').where('tenantId', '==', uid).limit(100).get(),
      db.collection('auditLogs').where('performedByEmail', '==', email).limit(100).get()
    ])

    const getSafeDate = (val) => {
      if (!val) return new Date(0)
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    const logsMap = new Map()
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

    const recentActivity = Array.from(logsMap.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }).slice(0, 20)

    // Compute metrics
    const activeDogs = dogs.filter(d => d.status !== 'transferred' && !d.isDeceased)
    let puppiesCount = 0
    litters.forEach(l => {
      if (Array.isArray(l.puppyIds)) {
        puppiesCount += l.puppyIds.length
      }
    })

    const createdDate = getSafeDate(profileData?.createdAt)

    const payload = {
      user: {
        uid,
        email,
        role,
        plan,
        emailVerified: authData ? authData.emailVerified : false,
        createdAt: authData && authData.metadata.creationTime ? new Date(authData.metadata.creationTime).toISOString() : (createdDate ? createdDate.toISOString() : null),
        lastSignInTime: authData && authData.metadata.lastSignInTime ? new Date(authData.metadata.lastSignInTime).toISOString() : null,
        firstName: profileData?.firstName || null,
        lastName: profileData?.lastName || null,
        kennelName: profileData?.kennelName || null,
        state: profileData?.state || null,
        phone: profileData?.phone || authData?.phoneNumber || null,
        subscriptionStatus: profileData?.subscriptionStatus || null,
        stripeSubscriptionId: profileData?.stripeSubscriptionId || null,
        dogsCount: activeDogs.length,
        littersCount: isOwner ? 0 : litters.length,
        puppiesCount: isOwner ? 0 : puppiesCount,
        dogs: dogs.map(d => ({
          id: d.id,
          name: d.name,
          breed: d.breed,
          sex: d.sex,
          dateOfBirth: d.dateOfBirth,
          lifeStage: d.lifeStage,
          isDeceased: d.isDeceased,
          status: d.status,
          association: d.tenantId === uid ? 'Breeder' : 'Owner'
        })),
        litters: isOwner ? [] : litters.map(l => ({
          id: l.id,
          name: l.name,
          actualBirthDate: l.actualBirthDate || l.expectedDueDate || null,
          puppiesCount: Array.isArray(l.puppyIds) ? l.puppyIds.length : 0
        })),
        recentActivity
      },
      limitations: {
        note: 'This report is compiled in-memory on demand and uses V1 tenant mapping assumptions.',
        profileMissing: !profileData ? 'Firestore profile document is missing for this account.' : null
      }
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error(`Failed to get details for user ${uid}:`, error)
    return res.status(500).json({ error: 'Failed to get user details', message: error.message })
  }
}
