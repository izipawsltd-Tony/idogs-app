// Read-only data source for the internal Super Admin workspace.
// Every request is authorized from a verified Firebase ID token; no email,
// role, query string, or client-side allowlist is trusted as authority.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { requireSuperAdmin } from './_lib/admin-access.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from './_lib/entitlements.js'
import { logSanitizedError } from './_lib/http-helpers.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const PLUS_MONTHLY_AUD = 5
const PLUS_ANNUAL_AUD = 49
const MAX_AUDIT_ROWS = 100

function iso(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString()
  return ''
}

function monthlyRevenue(profile, effectivePlan) {
  if (effectivePlan !== 'plus') return 0
  // Internal grants are product access, not revenue.
  if (hasValidInternalEntitlement(profile) && !profile.stripeSubscriptionId) return 0
  return profile.billingInterval === 'annual' ? PLUS_ANNUAL_AUD / 12 : PLUS_MONTHLY_AUD
}

function userRow(doc) {
  const profile = doc.data() || {}
  const effectivePlan = computeEffectivePlan(profile)
  return {
    id: doc.id,
    email: String(profile.email || ''),
    name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unnamed user',
    kennelName: String(profile.kennelName || ''),
    role: profile.role === 'breeder' || profile.role === 'admin' ? profile.role : 'owner',
    plan: effectivePlan,
    planSource: hasValidInternalEntitlement(profile) && !profile.stripeSubscriptionId ? 'internal' : (effectivePlan === 'plus' ? 'stripe' : 'free'),
    subscriptionStatus: String(profile.subscriptionStatus || ''),
    billingInterval: profile.billingInterval === 'annual' ? 'annual' : (profile.billingInterval === 'monthly' ? 'monthly' : ''),
    createdAt: iso(profile.createdAt),
    trialEndsAt: iso(profile.trialEndsAt),
    state: String(profile.state || ''),
    mrrAud: monthlyRevenue(profile, effectivePlan),
  }
}

function dogTenantId(data) {
  return String(data?.tenantId || data?.currentOwnerId || '')
}

function auditRow(doc) {
  const data = doc.data() || {}
  return {
    id: doc.id,
    timestamp: iso(data.createdAt),
    actor: String(data.performedByEmail || data.performedBy || 'System'),
    action: String(data.action || 'activity'),
    details: String(data.details || ''),
    tenantId: String(data.tenantId || ''),
    dogId: String(data.dogId || ''),
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const admin = await requireSuperAdmin(req, getAuth)
  if (!admin) return res.status(403).json({ error: 'Not authorized' })

  try {
    const db = getFirestore()
    const [usersSnap, dogsSnap, auditSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('dogs').get(),
      db.collection('auditLogs').get(),
    ])

    const users = usersSnap.docs.map(userRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const dogCounts = new Map()
    dogsSnap.docs.forEach(dog => {
      const tenantId = dogTenantId(dog.data())
      if (tenantId) dogCounts.set(tenantId, (dogCounts.get(tenantId) || 0) + 1)
    })

    const organisations = users
      .filter(user => user.role === 'breeder' || user.role === 'admin')
      .map(user => ({
        id: user.id,
        name: user.kennelName || user.name,
        ownerName: user.name,
        email: user.email,
        state: user.state,
        plan: user.plan,
        dogCount: dogCounts.get(user.id) || 0,
        createdAt: user.createdAt,
      }))

    const auditLogs = auditSnap.docs
      .map(auditRow)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_AUDIT_ROWS)

    const paidSubscriptions = users.filter(user => user.plan === 'plus' && user.planSource === 'stripe')
    const activeTrials = users.filter(user => user.plan === 'free' && user.trialEndsAt && new Date(user.trialEndsAt).getTime() > Date.now())
    const mrrAud = paidSubscriptions.reduce((sum, user) => sum + user.mrrAud, 0)

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      adminEmail: admin.email,
      metrics: {
        organisations: organisations.length,
        totalUsers: users.length,
        breeders: users.filter(user => user.role === 'breeder' || user.role === 'admin').length,
        owners: users.filter(user => user.role === 'owner').length,
        paidSubscriptions: paidSubscriptions.length,
        activeTrials: activeTrials.length,
        mrrAud: Math.round(mrrAud * 100) / 100,
        churnRate: null,
      },
      users,
      organisations,
      subscriptions: users.map(user => ({
        userId: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        source: user.planSource,
        status: user.subscriptionStatus || (user.plan === 'plus' ? 'active' : 'free'),
        interval: user.billingInterval,
        mrrAud: user.mrrAud,
      })),
      auditLogs,
    })
  } catch {
    logSanitizedError('super-admin-overview', 'READ_FAILED')
    return res.status(500).json({ error: 'Could not load the Super Admin workspace' })
  }
}

export default handler
