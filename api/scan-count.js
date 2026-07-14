// api/scan-count.js — Narrow, authenticated aggregate scan-count lookup.
//
// WHY THIS EXISTS: the old client-side getScanCount() queried `scanLogs`
// directly with the client SDK, but firestore.rules denies all client
// reads on that collection (ADR-002 §5 — scan logs must never be
// individually readable, or the passport becomes a stalking/tracking
// leak). That query always failed with permission-denied and was
// silently swallowed to 0 by the caller, so the UI showed a fabricated
// "0 scans" instead of an honest unknown state. This endpoint uses the
// Admin SDK (bypasses rules) to return ONLY a count, never the
// underlying scan documents (no IP, timestamp, user agent, or
// location), after verifying the caller actually owns/breeds the dog —
// same ownership check already used by get-signed-url.js/upload.js
// (dog.tenantId === uid || dog.currentOwnerId === uid), which
// intentionally keeps this available to a dog's original breeder after
// an ownership transfer, not just its current owner.
//
// Identifier choice: accepts dogId, not passportId. passportId is
// designed to be publicly discoverable (printed on QR codes/certs), so
// resolving it server-side here would add a passportId->dogId lookup
// with no benefit — the private Dog Detail UI that calls this already
// has dogId from its own route param.
//
// POST /api/scan-count
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId: string }
// Returns: { count: number } | 400 | 401 | 403 | 404 | 500

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { dogId } = req.body || {}
  if (!dogId || typeof dogId !== 'string') {
    return res.status(400).json({ error: 'dogId required' })
  }

  try {
    const db = getFirestore()
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) {
      return res.status(404).json({ error: 'Dog not found' })
    }
    const dog = dogSnap.data()

    // Ownership check: current owner, or the original/issuing breeder —
    // historical breeder access is intentional (same rule as
    // get-signed-url.js/upload.js), never anyone else.
    const isAuthorized = dog.tenantId === uid || dog.currentOwnerId === uid
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    // Aggregate count query — never transfers the underlying scanLogs
    // documents (no dogId/passportId/IP/timestamp/user agent) to this
    // handler at all, only a number.
    const countSnap = await db.collection('scanLogs').where('dogId', '==', dogId).count().get()
    const count = countSnap.data().count

    return res.status(200).json({ count })
  } catch (err) {
    console.error('scan-count error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
