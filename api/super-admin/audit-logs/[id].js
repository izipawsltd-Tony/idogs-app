// api/super-admin/audit-logs/[id].js — Get a single audit log event by document id
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
    return res.status(400).json({ error: 'Audit log id required' })
  }

  try {
    const db = getFirestore()

    const doc = await db.collection('auditLogs').doc(id).get()
    if (!doc.exists) {
      return res.status(404).json({ error: 'Audit log event not found' })
    }

    const d = doc.data()
    const performedBy = d.performedBy || null

    const [actorDoc, tenantDoc] = await Promise.all([
      performedBy ? db.collection('users').doc(performedBy).get() : Promise.resolve(null),
      d.tenantId ? db.collection('users').doc(d.tenantId).get() : Promise.resolve(null),
    ])

    const actorData = actorDoc && actorDoc.exists ? actorDoc.data() : null
    const tenantData = tenantDoc && tenantDoc.exists ? tenantDoc.data() : null

    const getSafeDate = (val) => {
      if (!val) return null
      if (typeof val.toDate === 'function') return val.toDate()
      return new Date(val)
    }
    const createdAtDate = getSafeDate(d.createdAt)

    return res.status(200).json({
      auditLog: {
        id: doc.id,
        createdAt: createdAtDate ? createdAtDate.toISOString() : null,
        action: d.action || 'unknown',
        details: d.details || '',
        tenantId: d.tenantId || null,
        dogId: d.dogId || null,
        dogName: d.dogName || null,
        performedBy,
        performedByEmail: d.performedByEmail || actorData?.email || null,
        actorRole: actorData?.role || null,
        tenantIsOrganisation: tenantData?.role === 'breeder',
      },
      dataModelNotice:
        'This event is displayed exactly as stored in the auditLogs collection. Actor role and organisation eligibility are derived by looking up performedBy/tenantId against user profiles, not a stored relationship.',
    })
  } catch (error) {
    console.error(`Failed to get audit log ${id}:`, error)
    return res.status(500).json({ error: 'Failed to get audit log event', message: error.message })
  }
}
