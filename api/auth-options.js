import { initializeApp, getApps, cert } from 'firebase-admin/app'
let cached, expires = 0
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'public, max-age=60')
  if (cached && Date.now() < expires) return res.status(200).json(cached)
  try {
    const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) })
    const token = await app.options.credential.getAccessToken()
    const project = encodeURIComponent(process.env.FIREBASE_PROJECT_ID)
    const [response, settingsResponse] = await Promise.all([
      fetch(`https://identitytoolkit.googleapis.com/v2/projects/${project}/defaultSupportedIdpConfigs`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(5000) }),
      fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(5000) }),
    ])
    if (!response.ok || !settingsResponse.ok) throw new Error('unavailable')
    const [data, settings] = await Promise.all([response.json(), settingsResponse.json()])
    cached = { providers: (data.defaultSupportedIdpConfigs || []).filter(c => c.enabled && ['google.com', 'facebook.com'].includes(c.name?.split('/').at(-1))).map(c => c.name.split('/').at(-1)), emailLink: settings.signIn?.email?.enabled === true && settings.signIn?.email?.passwordRequired === false, phone: settings.signIn?.phoneNumber?.enabled === true, phoneTestOnly: process.env.IDOGS_NATIVE_QA_BACKEND === '1' }
    expires = Date.now() + 60000
    return res.status(200).json(cached)
  } catch { return res.status(200).json({ providers: [] }) }
}
