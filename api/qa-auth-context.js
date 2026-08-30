import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers?.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' })

  try {
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7).trim())
    const uid = decoded?.uid || null
    if (!uid) return res.status(401).json({ error: 'Invalid token' })

    const profile = await db.collection('users').doc(uid).get()
    return res.status(200).json({
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
      uid,
      profileExists: profile.exists,
    })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
