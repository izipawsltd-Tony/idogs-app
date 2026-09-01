// api/create-litter.js — trusted server-side litter creation.
//
// POST /api/create-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { name?, damId, sireId?, sireName?, matingSuspectedDate?,
//         expectedDueDate?, actualBirthDate?, notes? }
// Returns: { litterId } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { validateBreedingParent } from './_lib/parent-eligibility.js'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { sanitizeLitterInput, LitterValidationError, CREATE_FIELDS } from './_lib/litter-schema.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from './_lib/entitlements.js'
import { relatedTenantIdsForBreederTx } from './_lib/breeder-profile.js'
import {
  decideLitterQuotaTx,
  consumeExtraLitterCredit,
  hasOtherUndatedPlannedLitter,
  writeLitterQuotaLedgerEntry,
  LITTER_QUOTA_BLOCK_MESSAGE,
  LITTER_PLAN_GATE_MESSAGE,
  LITTER_PLANNED_DUPLICATE_MESSAGE,
} from './_lib/litter-quota.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'Method not allowed')
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    throw new ApiError(401, 'Missing Authorization header')
  }

  let uid
  let authEmail = ''
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
    authEmail = typeof decoded.email === 'string' ? decoded.email : ''
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }

  const body = parseJsonBody(req)
  const { damId, sireId, ...rest } = body

  if (!damId || typeof damId !== 'string') {
    throw new ApiError(400, 'damId is required')
  }
  if (sireId !== undefined && sireId !== null && typeof sireId !== 'string') {
    throw new ApiError(400, 'sireId must be a string')
  }

  let safeFields
  try {
    safeFields = sanitizeLitterInput(rest, CREATE_FIELDS)
  } catch (err) {
    if (err instanceof LitterValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const useInAccountSire = sireId && sireId !== '__external__'

  const db = getFirestore()
  const damRef = db.collection('dogs').doc(damId)
  const sireRef = useInAccountSire ? db.collection('dogs').doc(sireId) : null
  const litterRef = db.collection('litters').doc()

  const result = await db.runTransaction(async (tx) => {
    // All reads intentionally precede every write.
    const damSnap = await tx.get(damRef)
    const sireSnap = sireRef ? await tx.get(sireRef) : null

    const damCheck = validateBreedingParent(damSnap.exists ? damSnap.data() : null, { uid, requiredSex: 'female' })
    if (!damCheck.valid) {
      return { ok: false, status: 400, body: { error: 'Dam is not an eligible breeding parent', reason: damCheck.reason } }
    }
    if (sireRef) {
      const sireCheck = validateBreedingParent(sireSnap.exists ? sireSnap.data() : null, { uid, requiredSex: 'male' })
      if (!sireCheck.valid) {
        return { ok: false, status: 400, body: { error: 'Sire is not an eligible breeding parent', reason: sireCheck.reason } }
      }
    }

    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const plan = computeEffectivePlan(profile)
    if (plan !== 'plus') {
      return { ok: false, status: 403, body: { error: LITTER_PLAN_GATE_MESSAGE, reason: 'LITTER_PLAN_GATE' } }
    }

    // Breeder Profile is the quota owner. Breeder ID is strongest;
    // phone/email are fallbacks; uid is only the final fallback.
    const breederScope = await relatedTenantIdsForBreederTx(tx, db, { uid, profile, authEmail })
    const isUnlimited = hasValidInternalEntitlement(profile)
    const whelpingDate = safeFields.actualBirthDate || ''
    const nowIso = new Date().toISOString()
    let quotaDecision = null

    if (whelpingDate) {
      if (!isUnlimited) {
        quotaDecision = await decideLitterQuotaTx(tx, db, {
          breederProfileId: breederScope.breederProfileId,
          tenantIds: breederScope.tenantIds,
          purchasedByUid: uid,
          newDate: whelpingDate,
        })
        if (!quotaDecision.allowed) {
          return { ok: false, status: 409, body: { error: LITTER_QUOTA_BLOCK_MESSAGE, reason: 'LITTER_QUOTA_EXCEEDED' } }
        }
      }
    } else if (!isUnlimited) {
      const hasPlanned = await hasOtherUndatedPlannedLitter(tx, db, breederScope.tenantIds)
      if (hasPlanned) {
        return { ok: false, status: 409, body: { error: LITTER_PLANNED_DUPLICATE_MESSAGE, reason: 'LITTER_PLANNED_DUPLICATE' } }
      }
    }

    const dam = damSnap.data()

    // No transaction reads after this point.
    if (quotaDecision?.credit) {
      consumeExtraLitterCredit(tx, quotaDecision.credit, { litterId: litterRef.id, consumedAt: nowIso })
    }

    tx.set(litterRef, {
      tenantId: uid,
      breederProfileId: breederScope.breederProfileId,
      name: safeFields.name?.trim() || `${dam.name} Litter`,
      damId,
      sireId: useInAccountSire ? sireId : null,
      sireName: sireId === '__external__' ? (safeFields.sireName?.trim() || null) : null,
      matingSuspectedDate: safeFields.matingSuspectedDate || '',
      expectedDueDate: safeFields.expectedDueDate || '',
      actualBirthDate: safeFields.actualBirthDate || '',
      notes: safeFields.notes || '',
      puppyIds: [],
      createdAt: nowIso,
    })

    if (whelpingDate) {
      const quotaSource = isUnlimited ? 'internal' : quotaDecision?.quotaSource || 'included'
      writeLitterQuotaLedgerEntry(tx, db, {
        tenantId: uid,
        breederProfileId: breederScope.breederProfileId,
        litterId: litterRef.id,
        whelpingDate,
        quotaSource,
        extraCreditId: quotaDecision?.credit?.id || null,
      })
    }
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ litterId: litterRef.id })
}

export default withApiErrorHandling('create-litter', handler)
