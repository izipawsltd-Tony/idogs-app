const EXPECTED_PROJECT = 'idogs-app-staging'
const EXPECTED_BRANCH = 'feat/mobile-app-foundation'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || ''
  const vercelEnv = process.env.VERCEL_ENV || ''
  const branch = process.env.VERCEL_GIT_COMMIT_REF || ''
  const dedicatedQaMarker = process.env.IDOGS_NATIVE_QA_BACKEND === '1'

  const dedicatedQa = dedicatedQaMarker && vercelEnv === 'production'
  const legacyProtectedPreview = vercelEnv === 'preview' && branch === EXPECTED_BRANCH
  const backendMode = dedicatedQa ? 'dedicated-qa' : (legacyProtectedPreview ? 'branch-preview' : 'invalid')
  const ok = firebaseProjectId === EXPECTED_PROJECT && dedicatedQa

  const body = {
    ok,
    firebaseProjectId,
    vercelEnv,
    branch,
    backendMode,
  }

  if (!ok) {
    return res.status(503).json({ ...body, error: 'NATIVE_QA_BACKEND_MISMATCH' })
  }

  return res.status(200).json(body)
}
