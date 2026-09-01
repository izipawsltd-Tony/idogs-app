// api/update-litter.js — trusted server-side litter field edits, with
// DOB propagation to still-owned puppies and Breeder Profile quota enforcement.
//
// POST /api/update-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, patch: { name?, matingSuspectedDate?, expectedDueDate?,
//         actualBirthDate?, notes? } }
// Returns: { updatedPuppyCount } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { partitionLitterCandidatesServer } from './_lib/litter-eligibility.js'
import { sanitizeLitterInput, LitterValidationError, UPDATE_FIELDS } from './_lib/litter-schema.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from './_lib/entitlements.js'
import { relatedTenantIdsForBreederTx } from './_lib/breeder-profile.js'
import {
  decideLitterQuotaTx,
  consumeExtraLitterCredit,
  writeLitterQuotaLedgerEntry,
  LITTER_QUOTA_BLOCK_MESSAGE,
  LITTER_PLAN_GATE_MESSAGE,
  LITTER_DATE_LOCKED_MESSAGE,
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
  const { litterId, patch } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (!patch || typeof patch !== 'object') {
    throw new ApiError(400, 'patch is required')
  }

  let safePatch
  try {
    safePatch = sanitizeLitterInput(patch, UPDATE_FIELDS)
  } catch (err) {
    if (err instanceof LitterValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const db = getFirestore()
  const litterRef = db.collection('litters').doc(litterId)

  const result = await db.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) {
      return { ok: false, status: 404, body: { error: 'Litter not found' } }
    }
    const litter = litterSnap.data()
    if (litter.tenantId !== uid) {
      return { ok: false, status: 403, body: { error: 'Not your litter' } }
    }
    if (litter.archived) {
      return { ok: false, status: 409, body: { error: 'This litter has been deleted and can no longer be edited', reason: 'LITTER_ARCHIVED' } }
    }

    const puppyIds = litter.puppyIds || []
    const hasPuppies = puppyIds.length > 0
    const previousActualBirthDate = litter.actualBirthDate || ''
    const dobChanged = Object.prototype.hasOwnProperty.call(safePatch, 'actualBirthDate') &&
      safePatch.actualBirthDate !== previousActualBirthDate

    // Once activated, the whelping date remains locked. This preserves the
    // permanent quota ledger and prevents re-dating to evade the window.
    if (dobChanged && previousActualBirthDate) {
      return { ok: false, status: 409, body: { error: LITTER_DATE_LOCKED_MESSAGE, reason: 'LITTER_DATE_LOCKED' } }
    }

    if (dobChanged && hasPuppies && !safePatch.actualBirthDate) {
      return { ok: false, status: 400, body: { error: 'This litter has puppies — actual birth date cannot be cleared' } }
    }

    const isActivating = dobChanged && !previousActualBirthDate && !!safePatch.actualBirthDate
    let breederScope = null
    let quotaDecision = null
    let isUnlimited = false
    const nowIso = new Date().toISOString()

    if (isActivating) {
      const userSnap = await tx.get(db.collection('users').doc(uid))
      const profile = userSnap.exists ? userSnap.data() : {}
      const plan = computeEffectivePlan(profile)
      if (plan !== 'plus') {
        return { ok: false, status: 403, body: { error: LITTER_PLAN_GATE_MESSAGE, reason: 'LITTER_PLAN_GATE' } }
      }

      breederScope = await relatedTenantIdsForBreederTx(tx, db, { uid, profile, authEmail })
      isUnlimited = hasValidInternalEntitlement(profile)

      if (!isUnlimited) {
        quotaDecision = await decideLitterQuotaTx(tx, db, {
          breederProfileId: breederScope.breederProfileId,
          tenantIds: breederScope.tenantIds,
          purchasedByUid: uid,
          newDate: safePatch.actualBirthDate,
          excludeLitterId: litterId,
        })
        if (!quotaDecision.allowed) {
          return { ok: false, status: 409, body: { error: LITTER_QUOTA_BLOCK_MESSAGE, reason: 'LITTER_QUOTA_EXCEEDED' } }
        }
      }
    }

    // These are the final transaction reads. Extra-credit consumption and
    // all litter/puppy writes happen only after these reads complete.
    let updatedPuppyCount = 0
    let eligiblePuppies = []
    if (dobChanged && safePatch.actualBirthDate && hasPuppies) {
      const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(db.collection('dogs').doc(id))))
      const fetched = candidateSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
      const { eligible } = partitionLitterCandidatesServer(litterId, fetched, uid)
      eligiblePuppies = eligible
      updatedPuppyCount = eligible.length
    }

    if (quotaDecision?.credit) {
      consumeExtraLitterCredit(tx, quotaDecision.credit, { litterId, consumedAt: nowIso })
    }

    for (const puppy of eligiblePuppies) {
      tx.update(db.collection('dogs').doc(puppy.id), { dateOfBirth: safePatch.actualBirthDate, updatedAt: nowIso })
    }

    const patchWithProfile = isActivating && breederScope
      ? { ...safePatch, breederProfileId: breederScope.breederProfileId }
      : safePatch
    tx.update(litterRef, patchWithProfile)

    if (isActivating && breederScope) {
      const quotaSource = isUnlimited ? 'internal' : quotaDecision?.quotaSource || 'included'
      writeLitterQuotaLedgerEntry(tx, db, {
        tenantId: uid,
        breederProfileId: breederScope.breederProfileId,
        litterId,
        whelpingDate: safePatch.actualBirthDate,
        quotaSource,
        extraCreditId: quotaDecision?.credit?.id || null,
      })
    }
    return { ok: true, updatedPuppyCount }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ updatedPuppyCount: result.updatedPuppyCount })
}

export default withApiErrorHandling('update-litter', handler)
