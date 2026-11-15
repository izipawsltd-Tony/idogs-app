import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { changeDeletionRequest, deletionStatus, DELETION_COLLECTION } from './_lib/account-deletion.js'

export function makeDeletionHandler({ authenticate, db }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    let token
    try {
      const header = req.headers.authorization || ''
      if (!header.startsWith('Bearer ')) throw new Error()
      token = await authenticate(header.slice(7))
      if (!token?.uid) throw new Error()
    } catch { return res.status(401).json({ error: 'Please sign in again.' }) }
    try {
      if (req.method === 'GET') {
        const snap = await db.collection(DELETION_COLLECTION).doc(token.uid).get()
        return res.status(200).json(deletionStatus(snap.exists ? snap.data() : null))
      }
      const result = await changeDeletionRequest({ db, token, body: req.body })
      return res.status(200).json(result)
    } catch (error) {
      const status = error.status || 500
      return res.status(status).json({ error: status === 500 ? 'Account deletion service is temporarily unavailable. No completion is confirmed.' : error.message })
    }
  }
}

export default async function handler(req, res) {
  try {
    if (!getApps().length) initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }) })
    return await makeDeletionHandler({ authenticate: token => getAuth().verifyIdToken(token, true), db: getFirestore() })(req, res)
  } catch { return res.status(503).json({ error: 'Account deletion service is temporarily unavailable.' }) }
}
