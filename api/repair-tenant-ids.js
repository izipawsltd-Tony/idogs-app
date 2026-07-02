// api/repair-tenant-ids.js — ONE-TIME repair for dogs whose tenantId
// was incorrectly overwritten by the claim-transferred-dogs bug.
//
// The bug set tenantId = buyer's uid on claimed dogs, which broke the
// breeder's getDogs() query (which filters by tenantId). tenantId must
// always equal the ORIGINAL BREEDER's uid. This endpoint restores it.
//
// Two strategies (tried in order):
//  1. originBreederId — for dogs created after that field was added
//  2. claimedAt — for older dogs that lack originBreederId; finds every
//     dog that went through the claim flow and whose tenantId is NOT
//     the breeder's uid
//
// POST /api/repair-tenant-ids
// Headers: x-cron-secret: <CRON_SECRET env var>
// Body: { breederEmail: "trunghieungo@gmail.com" }
// Returns: { fixed: number, dogs: string[], diagnostics: object }
//
// Safe to call multiple times — idempotent.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = req.headers['x-cron-secret']
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { breederEmail } = req.body
  if (!breederEmail) return res.status(400).json({ error: 'Missing breederEmail' })

  try {
    const db = getFirestore()

    // Resolve breeder uid from email
    let breederUid
    try {
      const breederUser = await getAuth().getUserByEmail(breederEmail)
      breederUid = breederUser.uid
    } catch {
      return res.status(404).json({ error: `No Firebase Auth user found for ${breederEmail}` })
    }

    // Fetch ALL dogs (admin SDK bypasses rules) to see raw tenantId values
    const allDogsSnap = await db.collection('dogs').get()
    const allDogs = allDogsSnap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name || '(no name)',
        tenantId: data.tenantId || null,
        currentOwnerId: data.currentOwnerId || null,
        originBreederId: data.originBreederId || null,
        status: data.status || null,
        claimedAt: data.claimedAt || null,
      }
    })

    const wrongTenantId = allDogs.filter(d => d.tenantId !== breederUid)
    const correctTenantId = allDogs.filter(d => d.tenantId === breederUid)

    const diagnostics = {
      breederUid,
      totalDogs: allDogs.length,
      dogsWithCorrectTenantId: correctTenantId.length,
      dogsWithWrongTenantId: wrongTenantId.length,
      allDogs,
    }

    // Fix any dogs that should belong to this breeder but have wrong tenantId.
    // "Should belong" = originBreederId matches, or claimedAt is set (old dogs
    // that predate originBreederId). Requires caller to confirm via the
    // diagnostics output before re-running with fix=true.
    const { fix } = req.body
    if (!fix) {
      return res.status(200).json({ message: 'Diagnostic only — pass fix:true to apply repair', diagnostics })
    }

    const affected = allDogs.filter(d =>
      d.tenantId !== breederUid &&
      (d.originBreederId === breederUid || d.claimedAt != null)
    )

    if (affected.length === 0) {
      return res.status(200).json({ fixed: 0, dogs: [], message: 'Nothing to repair', diagnostics })
    }

    const batch = db.batch()
    affected.forEach(d => {
      batch.update(db.collection('dogs').doc(d.id), {
        tenantId: breederUid,
        updatedAt: new Date(),
      })
    })
    await batch.commit()

    return res.status(200).json({
      fixed: affected.length,
      dogs: affected.map(d => `${d.id} (${d.name})`),
      diagnostics,
    })
  } catch (err) {
    console.error('repair-tenant-ids error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
