// api/super-admin/organisations/index.js — Get list of organisations (breeders)
import { getFirestore } from 'firebase-admin/firestore'
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

    // 2. Fetch data in parallel
    const [usersSnap, dogsSnap, littersSnap, auditSnap] = await Promise.all([
      db.collection('users').where('role', '==', 'breeder').get(),
      db.collection('dogs').get(),
      db.collection('litters').get(),
      db.collection('auditLogs').orderBy('createdAt', 'desc').limit(500).get()
    ])

    // 3. Process items in-memory
    const breedersList = []
    usersSnap.forEach(doc => {
      breedersList.push({ id: doc.id, ...doc.data() })
    })

    const dogsList = []
    dogsSnap.forEach(doc => {
      dogsList.push({ id: doc.id, ...doc.data() })
    })

    const littersList = []
    littersSnap.forEach(doc => {
      littersList.push({ id: doc.id, ...doc.data() })
    })

    const auditLogs = []
    auditSnap.forEach(doc => {
      auditLogs.push({ id: doc.id, ...doc.data() })
    })

    // Helpers to parse dates safely
    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    // Map each breeder to an organisation payload
    const organisations = breedersList.map(u => {
      const uid = u.id

      // Calculate totals
      const breederDogs = dogsList.filter(d => d.tenantId === uid && d.status !== 'transferred' && !d.isDeceased)
      const breederLitters = littersList.filter(l => l.tenantId === uid)
      
      let puppiesCount = 0
      breederLitters.forEach(l => {
        if (Array.isArray(l.puppyIds)) {
          puppiesCount += l.puppyIds.length
        }
      })

      // Extract last activity for this breeder
      // Check for logs either associated with their tenant ID or performed by their email
      const breederLogs = auditLogs.filter(log => 
        log.tenantId === uid || 
        (log.performedByEmail && log.performedByEmail.toLowerCase().trim() === (u.email || '').toLowerCase().trim())
      )
      
      let lastActivityDate = null
      if (breederLogs.length > 0) {
        // auditLogs query was already ordered desc, so the first match is the latest one
        lastActivityDate = getSafeDate(breederLogs[0].createdAt)
      }

      const createdDate = getSafeDate(u.createdAt)

      return {
        id: uid,
        name: u.kennelName || u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || (u.email ? u.email.split('@')[0] : 'Unnamed Breeder'),
        email: u.email || 'No email',
        plan: u.plan || 'trial',
        status: u.subscriptionStatus || (u.plan === 'trial' ? 'Trial' : 'Active'),
        createdAt: createdDate ? createdDate.toISOString() : null,
        dogsCount: breederDogs.length,
        littersCount: breederLitters.length,
        puppiesCount,
        lastActivity: lastActivityDate ? lastActivityDate.toISOString() : null
      }
    })

    // Sort organisations by registered date (newest first)
    organisations.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return timeB - timeA
    })

    return res.status(200).json({ organisations })
  } catch (error) {
    console.error('Failed to query organisations:', error)
    return res.status(500).json({ error: 'Failed to query organisations', message: error.message })
  }
}
