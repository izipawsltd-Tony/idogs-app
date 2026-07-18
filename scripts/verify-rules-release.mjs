#!/usr/bin/env node
// scripts/verify-rules-release.mjs — Release Runbook rollback
// verification (Codex round 6, Blocker 6).
//
// BUG THIS FIXES: the previous rollback verification instructions said
// to "attempt the exact operation the new Rules had denied (e.g. a
// direct client update to litters/{id}) against the SAME project" —
// i.e. mutate a REAL litter document (or attempt to) just to observe
// whether the write succeeds or fails. That is real business-data
// access during an incident, exactly when the deployed Rules' actual
// effect on real data is least well understood, and creates its own
// cleanup burden and risk (a "test" write against a document that isn't
// actually disposable).
//
// This script verifies the ACTIVE Firestore Rules release using the
// Firebase Rules Management REST API — READ-ONLY (GET requests only),
// never writes anything, never touches any collection/document, and
// never reads any business data (dogs/litters/users/etc.) at all. It
// fetches:
//   1. GET /v1/projects/{projectId}/releases/cloud.firestore
//      -> the currently ACTIVE ruleset's resource name for this project.
//   2. GET /v1/{rulesetName}
//      -> that ruleset's actual rules SOURCE content.
// ...then diffs that content against a local rules file (firestore.rules
// by default) and reports MATCH or MISMATCH. Nothing is deployed,
// nothing is mutated, no canary document of any kind is created.
//
// Wrong-project safety: the release lookup is scoped to the exact
// `projectId` argument in the request URL itself (not inferred from any
// ambient config), and the response's own resource `name` field is
// independently asserted to contain that same projectId before its
// content is trusted for anything — a response that somehow didn't
// match the requested project fails loudly instead of silently
// reporting a match against the wrong project.
//
// Usage:
//   node scripts/verify-rules-release.mjs <projectId> [localRulesPath]
// Example:
//   node scripts/verify-rules-release.mjs idogs-app-staging firestore.rules
//
// Requires: `firebase login` already run (uses the Firebase CLI's own
// stored credentials via `firebase login:print-access-token` — this
// script never asks for or stores a secret itself).
//
// Exit codes: 0 = confirmed match (rollback verified active).
//             1 = confirmed mismatch, or the check could not complete
//                 (auth/network/API failure, wrong-project response,
//                 malformed release/ruleset shape). Every failure mode
//                 is treated as "not verified" — never reported as a
//                 pass by default.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const RULES_API_BASE = 'https://firebaserules.googleapis.com/v1'

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

function normalize(rulesText) {
  // Whitespace/line-ending differences (CRLF vs LF, trailing newline)
  // must never register as a false MISMATCH — only actual rule content
  // differences matter here.
  return rulesText.replace(/\r\n/g, '\n').trim()
}

async function getAccessToken() {
  try {
    return execFileSync('npx', ['firebase-tools', 'login:print-access-token'], { encoding: 'utf8' }).trim()
  } catch (err) {
    throw new Error(`Could not obtain a Firebase access token (is 'firebase login' authenticated?): ${err.message}`)
  }
}

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${body ? JSON.stringify(body) : '(no body)'}`)
  }
  return body
}

async function main() {
  console.log(`Verifying the ACTIVE Firestore Rules release for project "${projectId}" (read-only, no business data touched)...`)

  const token = await getAccessToken()

  // Step 1: which ruleset is currently released for cloud.firestore?
  const releaseUrl = `${RULES_API_BASE}/projects/${encodeURIComponent(projectId)}/releases/cloud.firestore`
  const release = await fetchJson(releaseUrl, token)

  // Wrong-project safety: the release resource's own `name` must
  // explicitly contain this exact projectId — never trust a response
  // shape without checking it actually describes the project we asked
  // about.
  const expectedPrefix = `projects/${projectId}/`
  if (!release || typeof release.name !== 'string' || !release.name.startsWith(expectedPrefix)) {
    throw new Error(`Release response does not clearly identify project "${projectId}" (got name: ${release?.name ?? '(missing)'}) — refusing to trust it. Stop; do not proceed with rollback verification against this response.`)
  }
  if (typeof release.rulesetName !== 'string' || !release.rulesetName.startsWith(expectedPrefix)) {
    throw new Error(`Release's rulesetName does not clearly identify project "${projectId}" (got: ${release.rulesetName ?? '(missing)'}) — refusing to trust it.`)
  }

  // Step 2: fetch that ruleset's actual source content.
  const rulesetUrl = `${RULES_API_BASE}/${release.rulesetName}`
  const ruleset = await fetchJson(rulesetUrl, token)
  const files = ruleset?.source?.files
  if (!Array.isArray(files) || files.length === 0 || typeof files[0].content !== 'string') {
    throw new Error('Ruleset response did not contain the expected source.files[0].content shape — cannot verify.')
  }
  const deployedContent = normalize(files[0].content)
  const localContent = normalize(readFileSync(localRulesPath, 'utf8'))

  console.log(`Active ruleset: ${release.rulesetName}`)
  console.log(`Comparing against local file: ${localRulesPath}`)

  if (deployedContent === localContent) {
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
  console.error('Could not complete rollback verification:', err.message)
  console.error('Treat this as UNVERIFIED — do not proceed to the Vercel rollback step on the strength of an incomplete check.')
  process.exit(1)
})
