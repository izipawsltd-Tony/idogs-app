import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { computeEffectivePlan, hasValidInternalEntitlement } from './_lib/entitlements.js'
import { relatedTenantIdsForBreederTx } from './_lib/breeder-profile.js'
import {
  LITTER_INCLUDED_QUOTA,
  EXTRA_LITTER_PRICE_AUD,
  litterUsageWithinRollingWindow,
  listExtraLitterCreditsTx,
} from './_lib/litter-quota.js'
import { withApiErrorHandling, ApiError } from './_lib/http-helpers.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function tenantRelation(tenantId, uid, relatedTenantIds) {
  if (!tenantId) return 'unknown'
  if (tenantId === uid) return 'current-account'
  if (relatedTenantIds.includes(tenantId)) return 'related-account'
  return 'outside-scope'
}

async function buildPreviewDiagnostic(tx, db, { usage, breederScope, uid }) {
  if (process.env.VERCEL_ENV !== 'preview') return undefined

  const entries = []
  for (const entry of usage.entries) {
    let liveState = 'missing'
    let relation = 'unknown'

    if (entry.litterId) {
      const liveSnap = await tx.get(db.collection('litters').doc(entry.litterId))
      if (liveSnap.exists) {
        const live = liveSnap.data() || {}
        liveState = live.archived ? 'archived' : 'live'
        relation = tenantRelation(live.tenantId, uid, breederScope.tenantIds)
      } else {
        const ledgerSnap = await tx.get(db.collection('litterQuotaLedger').where('litterId', '==', entry.litterId))
        if (!ledgerSnap.empty) {
          liveState = 'ledger-only'
          relation = tenantRelation((ledgerSnap.docs[0].data() || {}).tenantId, uid, breederScope.tenantIds)
        }
      }
    }

    entries.push({
      source: entry.source,
      quotaSource: entry.quotaSource,
      whelpingDate: entry.whelpingDate,
      liveState,
      relation,
    })
  }

  return {
    identityKind: breederScope.identityKind,
    relatedTenantCount: breederScope.tenantIds.length,
    entries,
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed')

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!idToken) throw new ApiError(401, 'Missing Authorization header')

  let decoded
  try {
    decoded = await getAuth().verifyIdToken(idToken)
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }

  const uid = decoded.uid
  const authEmail = typeof decoded.email === 'string' ? decoded.email : ''
  const db = getFirestore()

  const summary = await db.runTransaction(async tx => {
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const plan = computeEffectivePlan(profile)
    const breederScope = await relatedTenantIdsForBreederTx(tx, db, { uid, profile, authEmail })

    const usage = await litterUsageWithinRollingWindow(tx, db, {
      breederProfileId: breederScope.breederProfileId,
      tenantIds: breederScope.tenantIds,
      newDate: todayUtc(),
    })
    const credits = await listExtraLitterCreditsTx(tx, db, {
      breederProfileId: breederScope.breederProfileId,
      purchasedByUid: uid,
    })
    const qaDiagnostic = await buildPreviewDiagnostic(tx, db, { usage, breederScope, uid })

    return {
      plan,
      unlimited: hasValidInternalEntitlement(profile),
      includedLimit: LITTER_INCLUDED_QUOTA,
      includedUsed: usage.includedUsed,
      extraLittersUsedInCurrentWindow: usage.extraUsed,
      extraCreditsAvailable: credits.filter(c => c.status === 'available').length,
      extraCreditsConsumed: credits.filter(c => c.status === 'consumed').length,
      extraLitterPriceAud: EXTRA_LITTER_PRICE_AUD,
      checkoutEnabled: process.env.EXTRA_LITTER_CHECKOUT_ENABLED === 'true',
      identityKind: breederScope.identityKind,
      ...(qaDiagnostic ? { qaDiagnostic } : {}),
    }
  })

  return res.status(200).json(summary)
}

export default withApiErrorHandling('litter-quota-summary', handler)
