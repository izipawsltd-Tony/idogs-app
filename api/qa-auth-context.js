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
const QA_EMAIL = 'idogsbreeder@gmail.com'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const authUser = await getAuth().getUserByEmail(QA_EMAIL)
    const uid = authUser.uid
    const profile = await db.collection('users').doc(uid).get()

    return res.status(200).json({
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
      email: QA_EMAIL,
      uid,
      profileExists: profile.exists,
    })
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'QA_LOOKUP_FAILED'
    return res.status(500).json({
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
      email: QA_EMAIL,
      error: code,
    })
  }
}
