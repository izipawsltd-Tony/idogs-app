// Preview-only read-only diagnostic for the single-user SMS QA gate.
// Access is additionally protected by Vercel Deployment Protection; this endpoint
// is never available in production. No SMS is sent and no data is mutated here.

const QA_EMAIL = 'idogsbreeder@gmail.com'
const QA_DOG_NAME = 'Black Boy'
const QA_WORMING_DUE = '2026-08-31'

function dateOnly(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

async function getOwnedDogs(db, uid) {
  const [byTenant, byOwner] = await Promise.all([
    db.collection('dogs').where('tenantId', '==', uid).get(),
    db.collection('dogs').where('currentOwnerId', '==', uid).get(),
  ])
  const dogs = new Map()
  byTenant.docs.forEach(doc => {
    const data = doc.data()
    if (data.status === 'transferred') return
    if (data.currentOwnerId && data.currentOwnerId !== uid) return
    dogs.set(doc.id, { id: doc.id, ...data })
  })
  byOwner.docs.forEach(doc => {
    const data = doc.data()
    if (data.status === 'transferred') return
    dogs.set(doc.id, { id: doc.id, ...data })
  })
  return [...dogs.values()]
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(403).json({ error: 'Preview-only QA diagnostic' })
  }
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const firebaseInfo = {
    serverProjectId: process.env.FIREBASE_PROJECT_ID || null,
    clientProjectId: process.env.VITE_FIREBASE_PROJECT_ID || null,
    serverConfigPresent: Boolean(
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ),
    cronSecretPresent: Boolean(process.env.CRON_SECRET),
  }

  if (!firebaseInfo.serverConfigPresent) {
    return res.status(200).json({
      safeToProceed: false,
      firebase: firebaseInfo,
      diagnosticError: { code: 'firebase-admin-config-missing' },
      checks: {
        previewEnvironment: true,
        firebaseAdminConfigPresent: false,
      },
    })
  }

  try {
    // Dynamic imports keep module-load failures inside this try/catch so Gate A
    // can report a sanitized error instead of an opaque serverless 500.
    const [{ initializeApp, getApps, cert }, { getAuth }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/auth'),
      import('firebase-admin/firestore'),
    ])

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      })
    }

    const db = getFirestore()
    const authUser = await getAuth().getUserByEmail(QA_EMAIL)
    const uid = authUser.uid
    const [userSnap, dogs, entitlementSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      getOwnedDogs(db, uid),
      db.collection('smsEntitlements').doc(uid).get(),
    ])

    const blackBoyMatches = dogs.filter(d => d.name === QA_DOG_NAME)
    const blackBoy = blackBoyMatches.length === 1 ? blackBoyMatches[0] : null

    let activeWorming = null
    if (blackBoy) {
      const wormingSnap = await db.collection('wormingRecords').where('dogId', '==', blackBoy.id).get()
      activeWorming = wormingSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(w => w.dateGiven)
        .sort((a, b) => dateOnly(b.dateGiven).localeCompare(dateOnly(a.dateGiven)))[0] || null
    }

    const user = userSnap.exists ? userSnap.data() : null
    const entitlement = entitlementSnap.exists ? entitlementSnap.data() : null
    const checks = {
      previewEnvironment: true,
      firebaseAdminConfigPresent: true,
      authEmailMatches: authUser.email === QA_EMAIL,
      userDocumentExists: userSnap.exists,
      userEmailMatches: !user?.email || user.email === QA_EMAIL,
      hasPhone: Boolean(user?.phone),
      blackBoyUnique: blackBoyMatches.length === 1,
      blackBoyOwnedByUid: Boolean(blackBoy && (blackBoy.currentOwnerId === uid || (!blackBoy.currentOwnerId && blackBoy.tenantId === uid))),
      wormingRecordExists: Boolean(activeWorming),
      wormingDueMatches: dateOnly(activeWorming?.nextDue) === QA_WORMING_DUE,
      smsEntitlementActive: entitlement?.status === 'active',
      smsCreditsIncluded20: Number(entitlement?.creditsIncluded) === 20,
      smsCreditsUsed0: Number(entitlement?.creditsUsed) === 0,
    }

    const safeToProceed = Object.values(checks).every(Boolean)
    return res.status(200).json({
      safeToProceed,
      firebase: firebaseInfo,
      qa: {
        email: QA_EMAIL,
        uid,
        emailReminders: user?.emailReminders ?? null,
        hasPhone: Boolean(user?.phone),
        ownedDogCount: dogs.length,
        blackBoy: blackBoy ? {
          id: blackBoy.id,
          tenantId: blackBoy.tenantId || null,
          currentOwnerId: blackBoy.currentOwnerId || null,
          status: blackBoy.status || null,
        } : null,
        activeWorming: activeWorming ? {
          id: activeWorming.id,
          dateGiven: dateOnly(activeWorming.dateGiven),
          nextDue: dateOnly(activeWorming.nextDue),
          lastReminderSentAt: activeWorming.lastReminderSentAt || null,
        } : null,
        smsEntitlement: entitlement ? {
          status: entitlement.status || null,
          creditsUsed: Number(entitlement.creditsUsed || 0),
          creditsIncluded: Number(entitlement.creditsIncluded || 0),
          currentPeriodStart: entitlement.currentPeriodStart || null,
          currentPeriodEnd: entitlement.currentPeriodEnd || null,
        } : null,
      },
      checks,
    })
  } catch (error) {
    const code = String(error?.code || 'qa-diagnostic-failed')
    const message = String(error?.message || '').slice(0, 160)
    console.error('single-user QA diagnostic failed', code)
    return res.status(200).json({
      safeToProceed: false,
      firebase: firebaseInfo,
      diagnosticError: { code, message },
      checks: {
        previewEnvironment: true,
        firebaseAdminConfigPresent: true,
      },
    })
  }
}
