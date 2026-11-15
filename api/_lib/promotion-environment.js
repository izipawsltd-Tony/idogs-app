// Read-only verified in Stripe Test mode: active iDogs Plus, AUD700/month.
// Never use a live Stripe session to QA a free-to-paid subscription.
export const STAGING_PLUS_MONTHLY_PRICE_ID = 'price_1U9YwuGHgBd6ZgJEX1Bdjz5x'
export function promotionEnvironment({ environment, projectId, firebaseProjectId, testKey, liveKey }) {
  const isolatedTest = environment === 'preview' && projectId === 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o' && firebaseProjectId === 'idogs-app-staging' && testKey === true
  return { enabled: environment === 'production' ? liveKey === true : isolatedTest,
    prices: isolatedTest ? { plus_monthly: STAGING_PLUS_MONTHLY_PRICE_ID } : undefined }
}

// Preserve Firebase's origin-scoped sign-in after hosted Checkout. The
// configured APP_URL must already be validated. Preview is additionally
// allowed only in isolated test mode, for its exact server-provided host.
// Never derive a callback from Host, forwarded headers or a body URL.
export function checkoutReturnOrigin({ appUrl, config, vercelUrl, requestOrigin }) {
  if (!appUrl) return null
  if (!config.prices) return appUrl
  if (appUrl !== 'https://idogs-app-staging.vercel.app') return null
  if (!requestOrigin || requestOrigin === appUrl) return appUrl
  if (typeof vercelUrl !== 'string' || !/^idogs-app-staging-[a-z0-9]+-izipawsltd-tonys-projects\.vercel\.app$/.test(vercelUrl)) return null
  const deploymentOrigin = `https://${vercelUrl}`
  return requestOrigin === deploymentOrigin ? deploymentOrigin : null
}
