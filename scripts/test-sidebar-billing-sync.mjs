import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
const checks = [
  ['sidebar fetches secure billing summary', source.includes("fetch('/api/billing-summary'")],
  ['sidebar reads verified entitlement plan', source.includes('body?.entitlement?.plan')],
  ['billing request is uid/generation guarded', source.includes('beginBillingPlanRequest') && source.includes('req.isCurrent()')],
  ['verified Stripe plan overrides cached profile', source.includes('verifiedBillingPlan ?? getEffectivePlanClient(profile)')],
  ['admin entitlement keeps explicit precedence', source.includes('const effectivePlan = hasAdminEntitlement')],
  ['upgrade CTA requires server-confirmed Free', source.includes("planCfg.upgrade && billingPlanResolved && verifiedBillingPlan === 'free' && !hasAdminEntitlement")],
  ['unknown billing state does not claim Free upgrade eligibility', source.includes("'Checking plan…'")],
]
let passed = 0
for (const [name, ok] of checks) {
  if (!ok) { console.error(`FAIL: ${name}`); process.exitCode = 1 }
  else { passed += 1; console.log(`PASS: ${name}`) }
}
console.log(`Sidebar billing sync: ${passed}/${checks.length} PASS`)
