// All new collections are server-only (existing Rules default-deny).
// QR is an identifier, never a credential. No email/SMS is sent here.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { withApiErrorHandling } from './_lib/http-helpers.js'
import { requireStorageBucket } from './_lib/require-config.js'
import { signMediaItems } from './_lib/showcase-media-access.js'

import { createPuppyUpdatesHandler } from './_lib/puppy-updates-handler.js'

if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })


export default withApiErrorHandling('puppy-updates', createPuppyUpdatesHandler({
  db: getFirestore(), timestamp: () => FieldValue.serverTimestamp(), verifyToken: token => getAuth().verifyIdToken(token),
  sign: (items, ttl) => signMediaItems(getStorage().bucket(requireStorageBucket()), items, ttl),
}))
