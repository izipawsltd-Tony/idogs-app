// api/super-admin/_auth.js — Reusable authorization helper for Super Admin
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

if (!getApps().length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
  privateKey = privateKey.trim()
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1)
  }
  if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
    privateKey = privateKey.slice(1, -1)
  }
  privateKey = privateKey.replace(/\\n/g, '\n').trim()

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}

// Single source of truth for the Super Admin allowlist on the server side.
// Mirrors SUPER_ADMIN_EMAILS in src/super-admin/superAdminConfig.ts (the
// frontend gate) — keep both lists in sync if this ever changes.
export const ALLOWED_ADMINS = ['trunghieungo@gmail.com', 'theresanguyenngo@gmail.com']

/**
 * Reusable helper to verify that a request is from the authorized Super Admin.
 * Returns the decoded token if authorized, or handles the response and returns null.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken | null>}
 */
export async function verifySuperAdmin(req, res) {
  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!idToken) {
    res.status(401).json({ error: 'Unauthorized: Missing Authorization header' })
    return null
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken)

    // Enforce verified email
    if (!decodedToken.email_verified) {
      res.status(403).json({ error: 'Forbidden: Email not verified' })
      return null
    }

    // Enforce Super Admin identity
    const email = decodedToken.email ? decodedToken.email.toLowerCase().trim() : ''
    if (!ALLOWED_ADMINS.includes(email)) {
      res.status(403).json({ error: 'Forbidden: Not authorized as Super Admin' })
      return null
    }

    return decodedToken
  } catch (error) {
    console.error('Super Admin Auth Error:', error.message)
    res.status(401).json({
      error: 'Unauthorized: Invalid or expired token',
      message: error.message,
      code: error.code
    })
    return null
  }
}
