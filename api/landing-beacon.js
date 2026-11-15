import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { landingBeaconHandler } from './_lib/landing-beacon.js'

export default async function handler(req, res) {
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
  return landingBeaconHandler({ db: getFirestore(app), increment: n => FieldValue.increment(n) })(req, res)
}
