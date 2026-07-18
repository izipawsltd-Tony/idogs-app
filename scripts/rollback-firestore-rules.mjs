#!/usr/bin/env node
// scripts/rollback-firestore-rules.mjs — Release Runbook Step 7
// ("Rollback"), Codex round 5, Blocker 8.
//
// BUG THIS FIXES: the previous rollback instructions extracted the
// previous-good rules to a SEPARATE file (firestore.rules.rollback) and
// then ran `firebase deploy --only firestore:rules`. That command always
// deploys whatever firebase.json's "firestore.rules" entry points
// at — which is firestore.rules itself, never firestore.rules.rollback.
// The old instructions therefore silently REDEPLOYED THE CURRENT (BAD)
// RULES AGAIN, not the rollback content — the rollback never actually
// took effect no matter how many times it was "run".
//
// This script fixes that by overwriting the ACTUAL deployed-rules file
// path (verified against firebase.json, not assumed) with the requested
// git ref's content, so the very next `firebase deploy --only
// firestore:rules` deploys what you actually intended. It does NOT run
// that deploy itself, and does NOT touch Vercel — deploying is a human
// decision, gated by explicit Tony approval for production per
// CLAUDE.md / RELEASE_RUNBOOK.md.
//
// Usage:
//   node scripts/rollback-firestore-rules.mjs <git-ref>
// Example:
//   node scripts/rollback-firestore-rules.mjs ae469147

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const RULES_PATH = join(REPO_ROOT, 'firestore.rules')

const gitRef = process.argv[2]
if (!gitRef) {
  console.error('Usage: node scripts/rollback-firestore-rules.mjs <git-ref>')
  process.exit(2)
}

// Confirm firebase.json actually points its "firestore.rules" entry at
// this exact file — if it doesn't, overwriting firestore.rules here
// would not be what actually gets deployed, reintroducing the same
// class of bug this script exists to fix, just one level removed.
const firebaseJsonPath = join(REPO_ROOT, 'firebase.json')
if (!existsSync(firebaseJsonPath)) {
  console.error('firebase.json not found at repo root — cannot confirm the deployed rules path. Aborting.')
  process.exit(1)
}
let firebaseJson
try {
  firebaseJson = JSON.parse(readFileSync(firebaseJsonPath, 'utf8'))
} catch (err) {
  console.error('firebase.json is not valid JSON — aborting rather than guessing the deployed rules path.', err.message)
  process.exit(1)
}
const configuredRulesPath = firebaseJson?.firestore?.rules
if (configuredRulesPath !== 'firestore.rules') {
  console.error(`firebase.json's firestore.rules path is "${configuredRulesPath}", not "firestore.rules" — this script only knows how to overwrite the latter safely. Aborting rather than guessing.`)
  process.exit(1)
}

let oldRulesContent
try {
  oldRulesContent = execFileSync('git', ['show', `${gitRef}:firestore.rules`], { encoding: 'utf8' })
} catch (err) {
  console.error(`Failed to read firestore.rules from git ref "${gitRef}":`, err.message)
  process.exit(1)
}
if (!oldRulesContent || !oldRulesContent.includes('rules_version')) {
  console.error(`Content read from "${gitRef}:firestore.rules" doesn't look like a valid rules file — aborting without touching anything.`)
  process.exit(1)
}

if (!existsSync(RULES_PATH)) {
  console.error(`${RULES_PATH} does not exist — aborting.`)
  process.exit(1)
}
const currentContent = readFileSync(RULES_PATH, 'utf8')
const backupPath = join(REPO_ROOT, `firestore.rules.pre-rollback-backup.${Date.now()}`)
writeFileSync(backupPath, currentContent, 'utf8')
console.log(`Backed up CURRENT firestore.rules to: ${backupPath}`)
console.log('(if this rollback itself needs undoing, that backup is the way back)')

writeFileSync(RULES_PATH, oldRulesContent, 'utf8')
console.log(`Restored firestore.rules from "${gitRef}" — this is now the exact file firebase.json's "rules" path points at.`)

console.log('')
console.log('This script does NOT deploy or verify anything — it only fixes the file')
console.log('on disk. Next (see RELEASE_RUNBOOK.md Step 7 for the full procedure):')
console.log('  1. Review the diff:')
console.log('       git diff firestore.rules')
console.log('  2. Deploy the restored rules:')
console.log('       firebase deploy --only firestore:rules --project idogs-app-staging')
console.log('       (or idogs-app for production, ONLY after explicit Tony approval)')
console.log('  3. VERIFY the rollback is actually active before touching Vercel — do not')
console.log('     assume a successful deploy command means the intended content is what')
console.log('     is now live. Attempt the exact operation the new Rules had denied (e.g.')
console.log('     a direct client update to litters/{id}) against the real project: it')
console.log('     should now be ALLOWED again if the rollback took effect. If it is still')
console.log('     denied, the deploy has not propagated yet (allow up to ~60s) or failed —')
console.log('     do not proceed to the Vercel rollback until this check passes.')
