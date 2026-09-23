const EXPECTED_PROJECT = 'idogs-app-staging'
const EXPECTED_ENV = 'preview'
const EXPECTED_BRANCH = 'feat/mobile-app-foundation'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || ''
  const vercelEnv = process.env.VERCEL_ENV || ''
  const branch = process.env.VERCEL_GIT_COMMIT_REF || ''
  const ok = firebaseProjectId === EXPECTED_PROJECT && vercelEnv === EXPECTED_ENV && branch === EXPECTED_BRANCH

  const body = {
    ok,
    firebaseProjectId,
    vercelEnv,
    branch,
  }

  if (!ok) {
    return res.status(503).json({ ...body, error: 'NATIVE_QA_BACKEND_MISMATCH' })
  }

  return res.status(200).json(body)
}
