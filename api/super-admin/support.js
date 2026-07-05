// api/super-admin/support.js — Read-only support operational signals
//
// iDogs V1 has no formal support/ticket collection (checked: support, supportTickets,
// tickets, helpRequests, contactMessages, feedback, bugReports, enquiries, messages —
// none exist in Firestore usage anywhere in the codebase). This endpoint does NOT
// invent or seed any support data. It surfaces read-only signals from data that
// already exists (recent audit events, recently registered accounts) so a Super
// Admin has somewhere useful to look while triaging a support request manually.
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { verifySuperAdmin } from './_auth.js'

const SIGNALS_LIMIT = 20
const RECENT_ACCOUNTS_LIMIT = 10

const DATA_MODEL_NOTICE =
  'iDogs V1 does not yet have a formal support ticket collection. This page currently surfaces support-related platform signals only.'

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

    const [auditSnap, usersSnap, authUsersSnap] = await Promise.all([
      db.collection('auditLogs').orderBy('createdAt', 'desc').limit(SIGNALS_LIMIT).get(),
      db.collection('users').get(),
      auth.listUsers(1000),
    ])

    const usersMap = {}
    usersSnap.forEach(doc => {
      const d = doc.data()
      usersMap[doc.id] = {
        email: d.email || null,
        role: d.role || 'breeder',
      }
    })

    const authUsersMap = {}
    authUsersSnap.users.forEach(u => {
      authUsersMap[u.uid] = {
        creationTime: u.metadata.creationTime || null,
      }
    })

    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    // 2. Recent audit events as read-only "signals" — not support tickets
    const signals = []
    auditSnap.forEach(doc => {
      const d = doc.data()
      const createdAtDate = getSafeDate(d.createdAt)
      const performedBy = d.performedBy || null
      const actor = performedBy ? usersMap[performedBy] : null
      const tenant = d.tenantId ? usersMap[d.tenantId] : null

      signals.push({
        id: doc.id,
        createdAt: createdAtDate ? createdAtDate.toISOString() : null,
        action: d.action || 'unknown',
        details: d.details || '',
        tenantId: d.tenantId || null,
        dogName: d.dogName || null,
        performedBy,
        performedByEmail: d.performedByEmail || actor?.email || null,
        tenantIsOrganisation: tenant?.role === 'breeder',
      })
    })

    // 3. Recently registered accounts — for manual inspection links only
    const usersList = []
    usersSnap.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }))

    const recentAccounts = usersList
      .map(u => {
        const authMeta = authUsersMap[u.id] || null
        const createdDate = authMeta?.creationTime ? new Date(authMeta.creationTime) : getSafeDate(u.createdAt)
        return {
          uid: u.id,
          email: u.email || 'No email',
          role: u.role || 'breeder',
          plan: u.plan || 'trial',
          createdAt: createdDate ? createdDate.toISOString() : null,
        }
      })
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })
      .slice(0, RECENT_ACCOUNTS_LIMIT)

    return res.status(200).json({
      supportItems: [],
      signals,
      recentAccounts,
      summary: {
        totalSupportItems: 0,
        recentSignalsCount: signals.length,
        recentAccountsCount: recentAccounts.length,
      },
      dataModelNotice: DATA_MODEL_NOTICE,
    })
  } catch (error) {
    console.error('Failed to compile support signals overview:', error)
    return res.status(500).json({ error: 'Failed to compile support signals overview', message: error.message })
  }
}
