#!/usr/bin/env node
// scripts/verify-rules-release.mjs — Release Runbook rollback
// verification (Codex round 6, Blocker 6; auth redesigned round 7,
// Blocker 2).
//
// BUG THIS FIXES (round 6): the previous rollback verification
// instructions said to "attempt the exact operation the new Rules had
// denied (e.g. a direct client update to litters/{id}) against the SAME
// project" — i.e. mutate a REAL litter document (or attempt to) just to
// observe whether the write succeeds or fails. That is real
// business-data access during an incident, exactly when the deployed
// Rules' actual effect on real data is least well understood, and
// creates its own cleanup burden and risk.
//
// This script verifies the ACTIVE Firestore Rules release using the
// Firebase Rules Management REST API — READ-ONLY (GET requests only),
// never writes anything, never touches any collection/document, and
// never reads any business data (dogs/litters/users/etc.) at all.
//
// AUTH REDESIGN (round 7, Blocker 2): the previous version shelled out
// to `npx firebase-tools login:print-access-token` — an undocumented,
// unpinned CLI subcommand with no stated support guarantee (npx always
// resolves whatever the latest installed/cached firebase-tools happens
// to be at run time). That command is gone. This script now obtains its
// access token the SAME documented way every trusted API endpoint in
// this project (api/create-litter.js, api/delete-litter.js, etc.)
// already authenticates to Firebase: a service-account credential built
// via firebase-admin/app's `cert()` from the SAME three env vars this
// codebase already requires everywhere else —
// FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.
// `Credential.getAccessToken()` is a stable, public, documented part of
// the firebase-admin SDK (it's how the SDK mints its own bearer tokens
// internally for every Admin SDK call), and firebase-admin is already a
// pinned package.json dependency — not an unpinned npx invocation, and
// no gcloud CLI install is required. See RELEASE_RUNBOOK.md for the
// exact setup/commands.
//
// The token is held only in memory for the duration of this process and
// used solely as a Bearer header on the two GET requests below — it is
// never printed, logged, or persisted to disk.
//
// Wrong-project safety: the release lookup is scoped to the exact
// `projectId` argument in the request URL itself (not inferred from any
// ambient config), and the response's own resource `name` field is
// independently asserted to contain that same projectId before its
// content is trusted for anything. Additionally (Codex round 8): if the
// local FIREBASE_PROJECT_ID doesn't match the `projectId` argument, this
// now REFUSES to proceed at all — no token is minted, no network call is
// made — rather than warning and continuing. See
// scripts/_lib/rules-release-verifier.mjs's assertProjectMatchesCredential().
//
// Usage:
//   node scripts/verify-rules-release.mjs <projectId> [localRulesPath]
// Example:
//   node scripts/verify-rules-release.mjs idogs-app-staging firestore.rules
//
// Requires: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
// FIREBASE_PRIVATE_KEY set in the current shell for the SAME project
// being verified (see RELEASE_RUNBOOK.md).
//
// Exit codes: 0 = confirmed match (rollback verified active).
//             1 = confirmed mismatch, or the check could not complete
//                 (auth/network/API failure, wrong-project response,
//                 malformed release/ruleset shape). Every failure mode
//                 is treated as "not verified" — never reported as a
//                 pass by default.
//             2 = usage error (bad arguments) — checked before any
//                 credential or network access is attempted.

import { readFileSync, existsSync } from 'node:fs'
import { cert } from 'firebase-admin/app'
import {
  verifyRulesRelease,
  RulesVerificationError,
} from './_lib/rules-release-verifier.mjs'

const projectId = process.argv[2]
const localRulesPath = process.argv[3] || 'firestore.rules'

if (!projectId) {
  console.error('Usage: node scripts/verify-rules-release.mjs <projectId> [localRulesPath]')
  process.exit(2)
}
if (!existsSync(localRulesPath)) {
  console.error(`Local rules file not found: ${localRulesPath}`)
  process.exit(2)
}

async function main() {
  console.log(`Verifying the ACTIVE Firestore Rules release for project "${projectId}" (read-only, no business data touched)...`)

  const { rulesetName, matches } = await verifyRulesRelease({
    projectId,
    localRulesContent: readFileSync(localRulesPath, 'utf8'),
    env: process.env,
    credentialFactory: cert,
  })

  console.log(`Active ruleset: ${rulesetName}`)
  console.log(`Comparing against local file: ${localRulesPath}`)

  if (matches) {
    console.log('MATCH — the deployed Rules release exactly matches the local file. Rollback verified active.')
    process.exit(0)
  }

  console.error('MISMATCH — the deployed Rules release does NOT match the local file.')
  console.error('STOP: do not proceed to the Vercel rollback step. Either:')
  console.error('  - the deploy has not propagated yet (Firestore Rules deploys can take up to')
  console.error('    ~60 seconds) — wait and re-run this script; or')
  console.error('  - the deploy targeted the wrong file/project — re-check RELEASE_RUNBOOK.md')
  console.error('    Step 8 and scripts/rollback-firestore-rules.mjs\'s own output before retrying; or')
  console.error('  - the deploy failed outright — check `firebase deploy` output/exit code directly.')
  process.exit(1)
}

main().catch((err) => {
  if (err instanceof RulesVerificationError) {
    console.error('Could not complete rollback verification:', err.message)
  } else {
    console.error('Could not complete rollback verification (unexpected error):', err.message)
  }
  console.error('Treat this as UNVERIFIED — do not proceed to the Vercel rollback step on the strength of an incomplete check.')
  process.exit(1)
})
