import fs from 'node:fs'

let passed = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
  passed += 1
  console.log(`PASS: ${message}`)
}

const api = fs.readFileSync('api/super-admin-overview.js', 'utf8')
const page = fs.readFileSync('src/pages/SuperAdminWorkspacePage.tsx', 'utf8')
const routes = fs.readFileSync('src/components/App.tsx', 'utf8')
const layout = fs.readFileSync('src/components/layout/AppLayout.tsx', 'utf8')

check(api.includes("requireSuperAdmin(req, getAuth)"), 'server verifies the caller with the shared Super Admin guard')
check(api.includes("if (req.method !== 'GET')"), 'overview endpoint only accepts GET')
const apiWithoutLocalMapWrites = api.replace(/dogCounts\.set/g, 'dogCounts.localSet')
check(!/\.(set|update|delete|add|create)\s*\(/.test(apiWithoutLocalMapWrites), 'overview endpoint contains no Firestore write call')
check(!api.includes('req.query') && !api.includes('req.body'), 'overview authority/data is not taken from client query or body')
check(api.includes("planSource: hasValidInternalEntitlement"), 'internal entitlement is distinguished from paid Stripe revenue')
check(api.includes("!profile.stripeSubscriptionId) return 0"), 'internal-only Plus contributes zero MRR')
check(page.includes("isSuperAdminEmail(user?.email)"), 'client hides workspace from non-admin users')
check(page.includes('fetchSuperAdminWorkspace()'), 'workspace loads through the protected server endpoint')
check(page.includes("'organisations'") && page.includes("'users'") && page.includes("'subscriptions'") && page.includes("'audit-logs'"), 'all Phase 1 sections are present')
check(page.includes('Pagination') && page.includes('placeholder="Search…"'), 'lists include pagination and search')
check(routes.includes('path="/app/super-admin/:section"'), 'dedicated Super Admin route is registered')
check(/<ProtectedRoute>\s*<SuperAdminWorkspacePage\s*\/>\s*<\/ProtectedRoute>/.test(routes), 'Super Admin route also requires normal verified authentication')
check(layout.includes('to="/app/super-admin/dashboard"'), 'existing shortcut now opens the internal workspace')
check(!layout.includes('idogs-admin-codex.vercel.app'), 'legacy external prototype link is removed')

console.log(`\n${passed} Super Admin Phase 1 checks passed.`)
