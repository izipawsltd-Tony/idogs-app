import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { withApiErrorHandling } from './_lib/http-helpers.js'
import { createBuyersHandler } from './_lib/buyers-handler.js'
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
export default withApiErrorHandling('buyers', createBuyersHandler({ db: getFirestore(), verifyToken: token => getAuth().verifyIdToken(token), timestamp: () => FieldValue.serverTimestamp() }))
