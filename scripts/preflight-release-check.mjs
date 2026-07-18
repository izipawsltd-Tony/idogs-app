#!/usr/bin/env node
// scripts/preflight-release-check.mjs — Release Runbook Step 1 (Codex
// round 4, Blocker 6).
//
// Confirms the required server-side env var NAMES exist in the target
// Vercel environment before deploying api/create-litter.js,
// api/save-heat-cycle.js, api/create-litter-puppy.js,
// api/update-litter.js, api/delete-litter.js, and
// api/remove-litter-puppy.js — all of them need exactly the same three
// Admin SDK credentials.
//
// Deliberately never reads or prints a VALUE — `vercel env ls` itself
// never exposes one (it prints "Encrypted" for every row), and this
// script only greps variable NAMES out of that output. Safe to run and
// safe to paste its output anywhere.
//
// Usage:
//   node scripts/preflight-release-check.mjs preview
//   node scripts/preflight-release-check.mjs production

import { execSync } from 'node:child_process'

const REQUIRED_VARS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
const VALID_ENVIRONMENTS = ['preview', 'production']

const target = process.argv[2]
if (!VALID_ENVIRONMENTS.includes(target)) {
  console.error(`Usage: node scripts/preflight-release-check.mjs <${VALID_ENVIRONMENTS.join('|')}>`)
  process.exit(2)
}

console.log(`Checking required server env var names for: ${target}\n`)

let output
try {
  // `target` is validated above against a fixed allowlist (VALID_ENVIRONMENTS)
  // before ever reaching here, so this interpolation carries no injection risk.
  output = execSync(`npx vercel env ls ${target}`, { encoding: 'utf8' })
} catch (err) {
  console.error('Failed to run `vercel env ls` — is the Vercel CLI installed and are you logged in?')
  console.error(err.message)
  process.exit(1)
}

// Each row starts with the variable name followed by whitespace — never
// parses or prints the "value" column (which is always the literal
// string "Encrypted" for a real Vercel project anyway, never a secret).
const presentNames = new Set(
  output
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean)
)

let allPresent = true
for (const name of REQUIRED_VARS) {
  const present = presentNames.has(name)
  console.log(`${present ? 'PASS' : 'FAIL'}: ${name} ${present ? 'is set' : 'is MISSING'} for ${target}`)
  if (!present) allPresent = false
}

console.log('')
if (!allPresent) {
  console.error(`STOP: one or more required env vars are missing for ${target}. Set them in Vercel -> Settings -> Environment Variables (scoped to ${target} only) before deploying. See RELEASE_RUNBOOK.md Step 1.`)
  process.exit(1)
}
console.log(`All required env vars are present for ${target}. Safe to proceed to RELEASE_RUNBOOK.md Step 2.`)
