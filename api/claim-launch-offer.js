// api/claim-launch-offer.js — authenticated claim of a free year of Plus
// (launch campaign). Logic and gates live in _lib/launch-offer-handler.js.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createLaunchClaimHandler } from './_lib/launch-offer-handler.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default createLaunchClaimHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  db: getFirestore(),
})
