import { checkoutReturnOrigin } from '../api/_lib/checkout-handler.js'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const previewEnv = {
  FIREBASE_PROJECT_ID: 'idogs-app-staging',
  VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o',
  VERCEL_URL: 'idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
}

check(
  'verified staging Preview may use its generated Vercel origin when APP_URL is absent',
  checkoutReturnOrigin(null, previewEnv) === 'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
)

check(
  'canonical validated APP_URL wins over Preview fallback',
  checkoutReturnOrigin('https://idogs-app-staging.vercel.app', previewEnv) === 'https://idogs-app-staging.vercel.app',
)

check(
  'invalid present APP_URL cannot silently fall back to generated Preview origin',
  checkoutReturnOrigin(null, { ...previewEnv, APP_URL: 'not-a-valid-origin' }) === null,
)

check(
  'production Firebase project cannot use staging Preview fallback',
  checkoutReturnOrigin(null, { ...previewEnv, FIREBASE_PROJECT_ID: 'idogs-app' }) === null,
)

check(
  'non-Preview Vercel environment cannot use staging Preview fallback',
  checkoutReturnOrigin(null, { ...previewEnv, VERCEL_ENV: 'production' }) === null,
)

check(
  'wrong Vercel project cannot use staging Preview fallback',
  checkoutReturnOrigin(null, { ...previewEnv, VERCEL_PROJECT_ID: 'prj_wrong' }) === null,
)

check(
  'untrusted Vercel hostname cannot be used as checkout return origin',
  checkoutReturnOrigin(null, { ...previewEnv, VERCEL_URL: 'evil.example.com' }) === null,
)

check(
  'hostname with protocol cannot be used as Preview fallback',
  checkoutReturnOrigin(null, { ...previewEnv, VERCEL_URL: 'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app' }) === null,
)

check(
  'hostname with mixed case is rejected rather than normalized implicitly',
  checkoutReturnOrigin(null, { ...previewEnv, VERCEL_URL: 'IDOGS-app-staging-abc123-izipawsltd-tonys-projects.vercel.app' }) === null,
)

await summary()
