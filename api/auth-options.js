import { initializeApp, getApps, cert } from 'firebase-admin/app'
let cached, expires = 0
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'public, max-age=60')
  if (cached && Date.now() < expires) return res.status(200).json(cached)
  try {
    const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
    const token = await app.options.credential.getAccessToken()
    const response = await fetch(`https://identitytoolkit.googleapis.com/v2/projects/${encodeURIComponent(process.env.FIREBASE_PROJECT_ID)}/defaultSupportedIdpConfigs`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('unavailable')
    const data = await response.json()
    cached = { providers: (data.defaultSupportedIdpConfigs || []).filter(c => c.enabled && ['google.com', 'facebook.com'].includes(c.name?.split('/').at(-1))).map(c => c.name.split('/').at(-1)) }
    expires = Date.now() + 60000
    return res.status(200).json(cached)
  } catch { return res.status(200).json({ providers: [] }) }
}
