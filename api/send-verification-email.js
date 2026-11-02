import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { verificationEmailHandler } from './_lib/verification-email.js'

export default async function handler(req, res) {
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
  const auth = getAuth(app)
  return verificationEmailHandler({
    verifyToken: token => auth.verifyIdToken(token, true),
    generateLink: (email, settings) => auth.generateEmailVerificationLink(email, settings),
    db: getFirestore(app),
    apiKey: process.env.IDOGS_NATIVE_QA_BACKEND === '1' ? null : process.env.RESEND_API_KEY,
  })(req, res)
}
