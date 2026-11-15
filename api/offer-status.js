// api/offer-status.js — public status of the launch campaign / 15-month pass.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createOfferStatusHandler } from './_lib/launch-offer-handler.js'
import { ACCESS_GRANT_COUNTERS, counterCount } from './_lib/access-grant-store.js'
import { LAUNCH_OFFER } from '../shared/access-grants.js'

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

export default createOfferStatusHandler({
  getLaunchClaimed: async () => counterCount(await db.collection(ACCESS_GRANT_COUNTERS).doc(LAUNCH_OFFER.id).get()),
})
