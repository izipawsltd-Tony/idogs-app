// api/super-admin/audit-logs/index.js — Read-only cross-tenant audit trail overview
//
// Read-only. Reuses the same `auditLogs` collection already queried by
// api/super-admin/dashboard.js and api/super-admin/organisations/index.js
// (orderBy('createdAt','desc') with no `where` clause needs no composite index).
import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from '../_auth.js'

const RECENT_LIMIT = 500

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return

  try {
    const db = getFirestore()

    const [auditSnap, usersSnap] = await Promise.all([
      db.collection('auditLogs').orderBy('createdAt', 'desc').limit(RECENT_LIMIT).get(),
      db.collection('users').get(),
    ])

    const usersMap = {}
    usersSnap.forEach(doc => {
      const d = doc.data()
      usersMap[doc.id] = {
        email: d.email || null,
        role: d.role || 'breeder',
      }
    })

    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }

    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const auditLogs = []
    auditSnap.forEach(doc => {
      const d = doc.data()
      const createdAtDate = getSafeDate(d.createdAt)
      const performedBy = d.performedBy || null
      const actor = performedBy ? usersMap[performedBy] : null
      const tenant = d.tenantId ? usersMap[d.tenantId] : null

      auditLogs.push({
        id: doc.id,
        createdAt: createdAtDate ? createdAtDate.toISOString() : null,
        action: d.action || 'unknown',
        details: d.details || '',
        tenantId: d.tenantId || null,
        dogId: d.dogId || null,
        dogName: d.dogName || null,
        performedBy,
        performedByEmail: d.performedByEmail || actor?.email || null,
        actorRole: actor?.role || null,
        tenantIsOrganisation: tenant?.role === 'breeder',
        isDeletionEvent: typeof d.action === 'string' && d.action.endsWith('_deleted'),
      })
    })

    // Already ordered desc by the query, but re-assert defensively in memory
    auditLogs.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })

    const totalRecentEvents = auditLogs.length
    const eventsLast24h = auditLogs.filter(l => l.createdAt && new Date(l.createdAt) >= oneDayAgo).length
    const uniqueActors = new Set(auditLogs.map(l => l.performedBy).filter(Boolean)).size
    const uniqueTenants = new Set(auditLogs.map(l => l.tenantId).filter(Boolean)).size
    const deletionEvents = auditLogs.filter(l => l.isDeletionEvent).length

    return res.status(200).json({
      auditLogs,
      summary: {
        totalRecentEvents,
        eventsLast24h,
        uniqueActors,
        uniqueTenants,
        deletionEvents,
      },
      dataModelNotice:
        `Showing the most recent ${RECENT_LIMIT} platform events. iDogs V1 audit log entries have no formal severity/risk or actor-role field — ` +
        `"Deletion events" approximates risk by counting delete-type actions, and actor role/organisation links are derived by cross-referencing ` +
        `the performedBy/tenantId fields against user profiles, not a stored relationship.`,
    })
  } catch (error) {
    console.error('Failed to compile audit logs overview:', error)
    return res.status(500).json({ error: 'Failed to compile audit logs overview', message: error.message })
  }
}
