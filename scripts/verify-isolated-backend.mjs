import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const base = '490717fe3786d1ec7a829363e2c83e1806f3e5a3'
const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const allowed = path => path.startsWith('api/') || path.startsWith('scripts/') || path === '.github/workflows/isolated-backend-candidate.yml' || path === 'docs/qa/isolated-backend-candidate-20261022.md'
assert.ok(changed.length > 0, 'Candidate has no changes')
assert.deepEqual(changed.filter(path => !allowed(path)), [], 'Out-of-scope changes compared with production')
for (const path of ['api/_lib/account-deletion.js', 'api/_lib/account-deletion-policy.js', 'api/account-deletion.js', 'api/_lib/account-deletion-ledger.js']) {
  assert.ok(!changed.includes(path), `Deletion lifecycle/execution gate changed: ${path}`)
}
const protectedPaths = ['src', 'public', 'mobile', 'ios', 'android', 'firestore.rules', 'firestore.indexes.json', 'storage.rules', 'package.json', 'package-lock.json', 'vercel.json', 'vite.config.ts', '.github/workflows/ci.yml']
assert.equal(execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', ...protectedPaths], {encoding:'utf8'}).trim(), '', 'Protected production assets/config changed')
console.log(JSON.stringify({ scope: 'isolated_backend', base, changedFiles: changed.length, protectedPathsUnchanged: true, liveDeletionLifecycleUnchanged: true }))
