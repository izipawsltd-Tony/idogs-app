// api/passport.js — Public QR Passport lookup.
//
// WHY THIS EXISTS: after locking down firestore.rules so only a dog's
// breeder/owner can read its document, the public "scan a QR code, see
// the dog's passport without logging in" flow broke (rules no longer
// allow an anonymous client to query `dogs` directly). This endpoint
// uses the Firebase Admin SDK (server-side, bypasses Firestore rules
// entirely) to do that lookup, returning an explicit field allowlist —
// never the raw document.
//
// ADR-002 Phase A (accepted 2026-07-14): microchip and ANKC/pedigree
// registration are private by default — removed from this allowlist.
// sourceType (with the same BREEDER_ISSUED legacy fallback used
// elsewhere) and isDeceased are added. Never add a real person's or
// organisation's name/identity to this response — see ADR-002 §5/§7.
//
// GET /api/passport?passportId=XXXXX
// Returns: { dog: {...}, vaccines: [...], healthTests: [...] } | 404

import { initializeApp, getApps, cert } from 'firebase-admin/app'
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

const db = getFirestore()

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { passportId } = req.query
  if (!passportId) {
    return res.status(400).json({ error: 'passportId required' })
  }

  try {
    const dogsSnap = await db.collection('dogs')
      .where('passportId', '==', passportId)
      .limit(1)
      .get()

    if (dogsSnap.empty) {
      return res.status(404).json({ error: 'Passport not found' })
    }

    const dogDoc = dogsSnap.docs[0]
    const dogData = dogDoc.data()

    // Explicit public allowlist (ADR-002 Phase A) — never the raw
    // document. Deliberately excludes: microchip, ankc/pedigree
    // registration (private by default per ADR-002 §9 Decisions 7-8),
    // tenantId, currentOwnerId, createdByUserId, originBreederId, notes,
    // buyer/reservation/deposit fields, breeder ID values, document
    // storage paths, and any real person/organisation name.
    const dog = {
      id: dogDoc.id,
      name: dogData.name,
      breed: dogData.breed,
      sex: dogData.sex,
      dateOfBirth: dogData.dateOfBirth,
      colour: dogData.colour,
      lifeStage: dogData.lifeStage,
      profilePhoto: dogData.profilePhoto || null,
      passportId: dogData.passportId,
      status: dogData.status || null,
      // Same read-time legacy fallback used throughout the app (see
      // normalizeDog() in src/lib/db.ts) — absence of sourceType means
      // "known-breeder-issued, pre-dating ADR-001", never "unknown".
      sourceType: dogData.sourceType || 'BREEDER_ISSUED',
      isDeceased: dogData.isDeceased || false,
    }

    const [vaccinesSnap, healthTestsSnap] = await Promise.all([
      db.collection('vaccineRecords').where('dogId', '==', dogDoc.id).get(),
      db.collection('healthTests').where('dogId', '==', dogDoc.id).get(),
    ])

    const vaccines = vaccinesSnap.docs.map(v => {
      const d = v.data()
      return {
        id: v.id,
        name: d.name,
        dateGiven: d.dateGiven,
        nextDue: d.nextDue || null,
        vetClinic: d.vetClinic || null,
        uncertain: d.uncertain || false,
      }
    })

    const healthTests = healthTestsSnap.docs.map(h => {
      const d = h.data()
      return {
        id: h.id,
        testType: d.testType,
        result: d.result,
        dateTested: d.dateTested,
        lab: d.lab || null,
        certNumber: d.certNumber || null,
      }
    })

    // Log the scan (write-only — clients can never read scanLogs back
    // per firestore.rules, only this trusted server can).
    try {
      await db.collection('scanLogs').add({
        dogId: dogDoc.id,
        passportId,
        scannedAt: new Date().toISOString(),
        result: 'public_view',
      })
    } catch (e) {
      console.error('scanLog write failed:', e)
    }

    return res.status(200).json({ dog, vaccines, healthTests })
  } catch (err) {
    console.error('Passport lookup error:', err)
    return res.status(500).json({ error: 'Internal error', message: String(err) })
  }
}
