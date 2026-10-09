import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function ensureAdmin() {
  if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
    privateKey = privateKey.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim()
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    })
  }
  return { auth: getAuth(), db: getFirestore() }
}

export async function verifyBreeder(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' }

  try {
    const { auth, db } = ensureAdmin()
    const decoded = await auth.verifyIdToken(token)
    if (!decoded.email_verified) return { ok: false, status: 403, error: 'Email not verified' }

    const snap = await db.collection('users').doc(decoded.uid).get()
    if (!snap.exists) return { ok: false, status: 403, error: 'Breeder profile not found' }
    const profile = snap.data() || {}
    if (profile.role !== 'breeder' && profile.role !== 'admin') {
      return { ok: false, status: 403, error: 'Breeder workspace required' }
    }

    return { ok: true, uid: decoded.uid, email: decoded.email || '', profile, db }
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token' }
  }
}

export function cleanText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export function cleanMoneyCents(value, max = 1000000000) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : 0
}
