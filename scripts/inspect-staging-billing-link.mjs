// One approved staging account only. No writes, tokens, keys or raw records.
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const project = 'idogs-app-staging'
const uid = 'iQnWhpEy3sUvRuBwneukJgQ3WBt2'
const email = 'trunghieungo@gmail.com'
try {
  const raw = process.env.STAGING_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('MISSING_STAGING_ADMIN_CREDENTIAL')
  let account
  try { account = JSON.parse(raw) } catch { throw new Error('INVALID_STAGING_ADMIN_CREDENTIAL') }
  if (account.project_id !== project || !account.client_email?.endsWith(`@${project}.iam.gserviceaccount.com`)) {
    throw new Error('WRONG_FIREBASE_PROJECT')
  }
  const app = initializeApp({ credential: cert(account), projectId: project })
  const identity = await getAuth(app).getUser(uid)
  if (identity.email !== email) throw new Error('QA_IDENTITY_MISMATCH')
  const snap = await getFirestore(app).collection('users').doc(uid).get()
  if (!snap.exists) throw new Error('QA_PROFILE_MISSING')
  const p = snap.data()
  const safeId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,80}$`).test(value) ? value : null
  console.log(JSON.stringify({ project, identityMatched: true,
    customer: safeId(p.stripeCustomerId, 'cus'), subscription: safeId(p.stripeSubscriptionId, 'sub'),
    customerFieldPresent: Boolean(p.stripeCustomerId), subscriptionFieldPresent: Boolean(p.stripeSubscriptionId),
    readOnly: true, writes: 0 }))
} catch (error) {
  const allowed = ['MISSING_STAGING_ADMIN_CREDENTIAL', 'INVALID_STAGING_ADMIN_CREDENTIAL', 'WRONG_FIREBASE_PROJECT', 'QA_IDENTITY_MISMATCH', 'QA_PROFILE_MISSING']
  console.error(allowed.includes(error.message) ? error.message : 'STAGING_BILLING_READ_FAILED')
  process.exitCode = 1
}
