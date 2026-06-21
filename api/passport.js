// api/passport.js — Public QR Passport lookup.
//
// WHY THIS EXISTS: after locking down firestore.rules so only a dog's
// breeder/owner can read its document, the public "scan a QR code, see
// the dog's passport without logging in" flow broke (rules no longer
// allow an anonymous client to query `dogs` directly). This endpoint
// uses the Firebase Admin SDK (server-side, bypasses Firestore rules
// entirely) to do that lookup, returning the same shape of data that
// PassportPublicPage.tsx already displayed before the rules change —
// full vaccine history, full health test results, breed/colour/sex/dob,
// microchip, ANKC. This matches existing behaviour exactly rather than
// silently hiding fields; whether some of these (microchip, ANKC) should
// stay fully public is a product decision for Izi, not something to
// change unilaterally here.
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

    // Only the fields PassportPublicPage.tsx actually renders — explicitly
    // NOT originBreederId, currentOwnerId, tenantId, notes, or anything
    // else that lives on the full Dog document but was never shown on
    // this public page.
    const dog = {
      id: dogDoc.id,
      name: dogData.name,
      breed: dogData.breed,
      sex: dogData.sex,
      dateOfBirth: dogData.dateOfBirth,
      colour: dogData.colour,
      microchip: dogData.microchip,
      ankc: dogData.ankc,
      lifeStage: dogData.lifeStage,
      profilePhoto: dogData.profilePhoto || null,
      passportId: dogData.passportId,
      status: dogData.status || null,
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
