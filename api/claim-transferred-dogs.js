// api/claim-transferred-dogs.js — Auto-claim dogs transferred to this
// buyer's email, run once whenever a signed-in user loads the dashboard.
//
// WHY THIS EXISTS: firestore.rules now restrict reading/updating a dog
// to its breeder (tenantId) or current owner (currentOwnerId). A buyer
// who just created an account to claim a transferred dog is, by
// definition, NEITHER of those yet — the dog still belongs to the
// seller until the claim completes. The old client-side
// claimTransferredDogs() in db.ts tried to query+update the dog
// directly from the browser, which the new rules correctly block. This
// endpoint uses the Admin SDK (bypasses rules) to do that lookup+update
// safely server-side, after verifying the caller's identity via their
// Firebase ID token — the email used to match transferred dogs comes
// from the VERIFIED token claim, not anything the client could spoof.
//
// POST /api/claim-transferred-dogs
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { claimed: number }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  let uid, email
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
    email = decoded.email
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  if (!email) {
    console.log('[claim-diag] No email in token, uid:', uid)
    return res.status(200).json({ claimed: 0 })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const action = body.action === 'check' ? 'check' : 'claim'

  console.log('[claim-diag] token email:', email, '| uid:', uid, '| action:', action, '| project:', process.env.FIREBASE_PROJECT_ID)

  try {
    const db = getFirestore()

    // Diagnostic: check ALL dogs with this buyerEmail regardless of transferStatus
    const allByEmail = await db.collection('dogs')
      .where('buyerEmail', '==', email.toLowerCase())
      .get()
    console.log('[claim-diag] dogs with buyerEmail=' + email.toLowerCase() + ':', allByEmail.size,
      allByEmail.docs.map(d => ({ id: d.id, name: d.data().name, status: d.data().status, transferStatus: d.data().transferStatus })))

    const dogsSnap = await db.collection('dogs')
      .where('buyerEmail', '==', email.toLowerCase())
      .where('transferStatus', '==', 'pendingClaim')
      .get()

    console.log('[claim-diag] pendingClaim dogs:', dogsSnap.size)

    if (dogsSnap.empty) {
      return res.status(200).json({ dogs: [], claimed: 0 })
    }

    if (action === 'check') {
      const dogs = []
      dogsSnap.forEach(d => {
        const data = d.data()
        dogs.push({
          id: d.id,
          name: data.name,
          breed: data.breed,
          profilePhoto: data.profilePhoto || null,
          transferredAt: data.transferredAt,
        })
      })
      return res.status(200).json({ dogs })
    }

    const batch = db.batch()
    dogsSnap.docs.forEach(d => {
      batch.update(d.ref, {
        // tenantId intentionally NOT updated — it must stay as the
        // original breeder's uid forever so their getDogs() still works.
        currentOwnerId: uid,
        status: 'active',
        transferStatus: FieldValue.delete(),
        claimedAt: new Date().toISOString(),
        claimedBy: uid,
        updatedAt: new Date(),
      })
    })
    await batch.commit()

    return res.status(200).json({ claimed: dogsSnap.size })
  } catch (err) {
    console.error('claim-transferred-dogs error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
