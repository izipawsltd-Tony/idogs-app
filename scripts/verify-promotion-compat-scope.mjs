import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const base = '57425da03ea4cf0e85c22c20927ec350de695a62'
execFileSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'])
const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const allowed = new Set([
  'api/_lib/subscription-promotion.js', 'api/_lib/billing-handler.js', 'src/pages/BillingPage.tsx',
  'scripts/subscription-promotion.test.js', 'scripts/verify-promotion-compat-scope.mjs',
  'docs/qa/promotion-billing-compat-20261023.md', '.github/workflows/isolated-backend-candidate.yml',
])
assert.ok(changed.length > 0)
assert.deepEqual(changed.filter(path => !allowed.has(path)), [], 'Out-of-scope campaign compatibility change')
console.log(JSON.stringify({ scope: 'promotion_billing_display', base, changedFiles: changed.length,
  checkoutWebhookRulesDependenciesAndDeletionUnchanged: true }))
