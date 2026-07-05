// api/super-admin/users/index.js — Get list of all platform users
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

  try {
    const db = getFirestore()
    const auth = getAuth()

    // 2. Fetch users and dogs in parallel
    const [usersSnap, dogsSnap, authUsersSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('dogs').get(),
      auth.listUsers(1000) // List up to 1000 auth accounts (suitable for staging/v1)
    ])

    const usersList = []
    usersSnap.forEach(doc => {
      usersList.push({ id: doc.id, ...doc.data() })
    })

    const dogsList = []
    dogsSnap.forEach(doc => {
      dogsList.push({ id: doc.id, ...doc.data() })
    })

    // 3. Map Firebase Auth accounts for rapid lookup
    const authUsersMap = {}
    authUsersSnap.users.forEach(u => {
      authUsersMap[u.uid] = {
        emailVerified: u.emailVerified || false,
        lastSignInTime: u.metadata.lastSignInTime || null,
        creationTime: u.metadata.creationTime || null
      }
    })

    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    // 4. Combine Firestore profile and Auth status datasets in memory
    const users = usersList.map(u => {
      const uid = u.id
      const authMeta = authUsersMap[uid] || null

      // Count associated dogs based on role
      const isOwner = u.role === 'owner'
      const userDogs = dogsList.filter(d => 
        (isOwner ? d.currentOwnerId === uid : d.tenantId === uid) && 
        d.status !== 'transferred' && 
        !d.isDeceased
      )

      // Fallback created date
      const createdDate = getSafeDate(u.createdAt)

      return {
        uid,
        email: u.email || 'No email',
        role: u.role || 'breeder',
        plan: u.plan || 'trial',
        emailVerified: authMeta ? authMeta.emailVerified : false,
        createdAt: authMeta && authMeta.creationTime ? new Date(authMeta.creationTime).toISOString() : (createdDate ? createdDate.toISOString() : null),
        lastSignInTime: authMeta && authMeta.lastSignInTime ? new Date(authMeta.lastSignInTime).toISOString() : null,
        dogsCount: userDogs.length
      }
    })

    // Sort users by registration date (newest first)
    users.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return timeB - timeA
    })

    return res.status(200).json({ users })
  } catch (error) {
    console.error('Failed to list platform users:', error)
    return res.status(500).json({ error: 'Failed to list platform users', message: error.message })
  }
}
