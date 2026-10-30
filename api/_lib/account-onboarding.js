import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export const READINESS_COLLECTION = 'accountReadiness'
export const onboardingEnabled = (env = process.env) => env.IDOGS_ACCOUNT_ONBOARDING_GATE === '1'
export function assertOnboardingEnvironment(env = process.env) {
  if (!['idogs-app-staging', 'demo-idogs-account-mobile', 'demo-idogs-account-onboarding'].includes(env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT)) throw new Error('Onboarding is restricted to staging/demo')
}
const fail = (status, code) => Object.assign(new Error(code), { status, code })
const emailOf = user => (user.email || '').toLowerCase()
export async function accountReadiness({ user, db }) {
  if (user.disabled) throw fail(401, 'account/disabled')
  const record = (await db.collection(READINESS_COLLECTION).doc(user.uid).get()).data()
  return { required: true, ready: !!(user.email && user.emailVerified && user.providerData.some(p => p.providerId === 'password') && record?.version === 1 && record.uid === user.uid && record.email === emailOf(user) && record.createdAuthAt === user.metadata.creationTime) }
}

// Keep default production behavior until its deployment/configuration gate is
// approved. Enabling this flag for an unexpected project fails CLOSED.
export async function verifyAccountToken(token, auth = getAuth(), db, env = process.env) {
  if (!onboardingEnabled(env)) return auth.verifyIdToken(token)
  assertOnboardingEnvironment(env)
  const identity = await auth.verifyIdToken(token, true)
  const user = await auth.getUser(identity.uid)
  const state = await accountReadiness({ user, db: db || getFirestore() })
  if (!state.ready || identity.firebase?.sign_in_provider !== 'password') throw fail(403, 'account/setup-required')
  return identity
}

export function makeOnboardingHandler({ auth, db, verifyPassword, env = process.env }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!onboardingEnabled(env)) return res.status(503).json({ error: 'Account setup is unavailable on this deployment.' })
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    try {
      assertOnboardingEnvironment(env)
      const header = req.headers.authorization || ''
      if (!header.startsWith('Bearer ')) throw fail(401, 'account/sign-in-required')
      const identity = await auth.verifyIdToken(header.slice(7), true)
      let user = await auth.getUser(identity.uid)
      if (user.disabled) throw fail(401, 'account/disabled')
      if (req.method === 'GET') {
        const state = await accountReadiness({ user, db })
        return res.status(200).json({ ...state, ready: state.ready && identity.firebase?.sign_in_provider === 'password' })
      }
      if (typeof req.body === 'string' && Buffer.byteLength(req.body) > 2048) throw fail(400, 'account/invalid-request')
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (!body || Array.isArray(body) || Object.keys(body).some(k => k !== 'password') || typeof body.password !== 'string' || !body.password.length || body.password.length > 128) throw fail(400, 'account/invalid-password')
      if (!user.emailVerified || !user.email) throw fail(403, 'account/verify-email-first')
      if (identity.firebase?.sign_in_provider !== 'password') throw fail(403, 'account/password-session-required')
      const age = Date.now() / 1000 - Number(identity.auth_time)
      if (!Number.isFinite(age) || age < -30 || age > 300) throw fail(401, 'account/recent-sign-in-required')
      const attemptRef = db.collection('accountSetupAttempts').doc(user.uid)
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(attemptRef), previous = snapshot.data(), time = Date.now()
        const count = previous && time - previous.windowStart < 900000 ? previous.count : 0
        if (count >= 5) throw fail(429, 'account/too-many-attempts')
        tx.set(attemptRef, { windowStart: count ? previous.windowStart : time, count: count + 1 })
      })
      // providerId=password also covers email-link accounts. Prove a REAL
      // password against Auth instead of trusting providerData or a client flag.
      const proof = await verifyPassword(user.email, body.password)
      if (proof.uid !== user.uid) throw fail(403, 'account/identity-mismatch')
      const original = user
      user = await auth.getUser(identity.uid)
      if (user.disabled || !user.emailVerified || emailOf(user) !== emailOf(original) || user.tokensValidAfterTime !== original.tokensValidAfterTime) throw fail(401, 'account/sign-in-again')
      const deletion = (await db.doc(`accountDeletionRequests/${user.uid}`).get()).data()
      if (deletion && !['none', 'cancelled'].includes(deletion.status)) throw fail(403, 'account/unavailable')
      await db.collection(READINESS_COLLECTION).doc(user.uid).set({ uid: user.uid, email: emailOf(user), version: 1, createdAuthAt: user.metadata.creationTime, confirmedAt: Date.now() })
      return res.status(200).json({ required: true, ready: true })
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : [400, 401, 403, 429].includes(error.status) ? error.status : 503
      // Never log request bodies, passwords, Auth REST responses or tokens.
      return res.status(status).json({ error: status === 503 ? 'Could not confirm account setup. Please try again.' : error.code === 'account/verify-email-first' ? 'Verify your email before continuing.' : status === 401 ? 'Please sign in to this account again.' : 'Could not confirm this password for your current account.' })
    }
  }
}

export function passwordVerifier({ apiKey, env = process.env, fetchImpl = fetch }) {
  assertOnboardingEnvironment(env)
  const demo = ['demo-idogs-account-mobile', 'demo-idogs-account-onboarding'].includes(env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT)
  if (demo && !['127.0.0.1:9299', '127.0.0.1:9399'].includes(env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('Demo password proof requires loopback Auth emulator')
  if (!apiKey) throw new Error('Password proof requires the configured web API key')
  const origin = demo ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com'
  return async (email, password) => {
    const r = await fetchImpl(`${origin}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw fail(r.status === 429 ? 429 : 403, 'account/password-unconfirmed')
    const data = await r.json()
    if (typeof data.localId !== 'string') throw fail(403, 'account/password-unconfirmed')
    return { uid: data.localId }
  }
}
