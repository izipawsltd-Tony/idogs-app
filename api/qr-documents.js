import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { createQrDocumentsHandler } from './_lib/qr-documents-handler.js'
import { createDocumentDelivery } from './_lib/document-delivery.js'
import { requireStorageBucket } from './_lib/require-config.js'
import { ApiError, logSanitizedError } from './_lib/http-helpers.js'
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
const handle = createQrDocumentsHandler({ db: getFirestore(), verifyToken: token => getAuth().verifyIdToken(token), timestamp: () => FieldValue.serverTimestamp(), serve: (...args) => createDocumentDelivery(getStorage().bucket(requireStorageBucket()))(...args) })
export default async function handler(req, res) {
  try { return await handle(req, res) }
  catch (error) {
    if (res.headersSent) { res.destroy(); return }
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message })
    logSanitizedError('qr-documents', 'REQUEST_FAILED')
    return res.status(500).json({ error: 'Could not load shared documents' })
  }
}
