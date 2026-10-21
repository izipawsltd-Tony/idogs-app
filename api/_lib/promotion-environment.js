// The existing isolated staging SMS integration already uses this test Price.
// Never use a live Stripe session to QA a free-to-paid subscription.
export const STAGING_PLUS_MONTHLY_PRICE_ID = 'price_1TxaNJGHgBd6ZgJEpAhrWark'
export function promotionEnvironment({ environment, projectId, firebaseProjectId, testKey, liveKey }) {
  const isolatedTest = environment === 'preview' && projectId === 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o' && firebaseProjectId === 'idogs-app-staging' && testKey === true
  return { enabled: environment === 'production' ? liveKey === true : isolatedTest,
    prices: isolatedTest ? { plus_monthly: STAGING_PLUS_MONTHLY_PRICE_ID } : undefined }
}
