import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { assertOnboardingEnvironment, makeOnboardingHandler, onboardingEnabled, passwordVerifier } from './_lib/account-onboarding.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!onboardingEnabled()) return res.status(503).json({ error: 'Account setup is unavailable on this deployment.' })
  try {
    assertOnboardingEnvironment()
    const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
    return await makeOnboardingHandler({ auth: getAuth(app), db: getFirestore(app), verifyPassword: passwordVerifier({ apiKey: process.env.FIREBASE_WEB_API_KEY }) })(req, res)
  } catch { return res.status(503).json({ error: 'Account setup is unavailable on this deployment.' }) }
}
