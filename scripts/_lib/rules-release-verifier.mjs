// scripts/_lib/rules-release-verifier.mjs — testable core logic for
// verify-rules-release.mjs (Codex round 7, Blocker 2).
//
// WHY THIS EXISTS: the previous version of verify-rules-release.mjs
// shelled out to `npx firebase-tools login:print-access-token` — an
// UNDOCUMENTED, unpinned (npx always resolves whatever the latest
// installed/cached firebase-tools happens to be) CLI subcommand with no
// stated support guarantee. This module replaces it with a token
// obtained the SAME documented way the six trusted API endpoints in
// this project (api/create-litter.js etc) already authenticate to
// Firebase: a service account credential built via
// firebase-admin/app's cert() from the SAME three env vars
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
// this codebase already documents and requires everywhere else — no new
// tool to install, no gcloud dependency, nothing to separately set up.
// `Credential.getAccessToken()` is a stable, public, documented part of
// the firebase-admin SDK (it's how the SDK mints its own tokens
// internally for every Admin SDK call), and firebase-admin is already a
// pinned package.json dependency, not an unpinned npx invocation.
//
// Every function here takes its external dependencies (the credential
// object, the fetch implementation) as parameters rather than reaching
// for global state directly, specifically so tests can inject fakes —
// no real service account keys or network access are needed to
// exercise this module's logic.

export class RulesVerificationError extends Error {}

const REQUIRED_ENV_VARS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']

// Preflight — never prints a value, only which NAMES are missing (same
// contract as scripts/preflight-release-check.mjs).
export function checkRequiredEnvVars(env) {
  const missing = REQUIRED_ENV_VARS.filter(key => !env[key])
  if (missing.length > 0) {
    throw new RulesVerificationError(
      `Missing required env var(s): ${missing.join(', ')}. These are the same three ` +
      `variables every trusted API endpoint in this project already requires (see ` +
      `CLAUDE.md's "Vercel env vars" note and RELEASE_RUNBOOK.md Step 1) — set them for ` +
      `the project you're verifying before running this script.`
    )
  }
}

// `credential` must implement getAccessToken(): Promise<{ access_token }>
// — exactly the interface firebase-admin/app's cert() returns. Injected
// so tests can supply a fake one. The token itself is returned to the
// caller to use as a Bearer header — this function never logs it.
export async function getAccessToken(credential) {
  let result
  try {
    result = await credential.getAccessToken()
  } catch (err) {
    throw new RulesVerificationError(
      `Failed to acquire an access token from the service account credential: ${err.message}. ` +
      `Confirm FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY are correct and ` +
      `that this service account has not been disabled or deleted.`
    )
  }
  if (!result || typeof result.access_token !== 'string' || !result.access_token) {
    throw new RulesVerificationError('The service account credential did not return a usable access token.')
  }
  return result.access_token
}

const RULES_API_BASE = 'https://firebaserules.googleapis.com/v1'

// `fetchImpl` injected (defaults to the global fetch) purely so tests
// can mock the HTTP layer without any real network access. GET-only —
// never issues a write of any kind, never touches any Firestore
// collection or document.
export async function fetchActiveRulesetContent(projectId, accessToken, fetchImpl = fetch) {
  const releaseUrl = `${RULES_API_BASE}/projects/${encodeURIComponent(projectId)}/releases/cloud.firestore`
  const releaseRes = await fetchImpl(releaseUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  const release = await releaseRes.json().catch(() => null)
  if (!releaseRes.ok) {
    throw new RulesVerificationError(`GET releases/cloud.firestore -> HTTP ${releaseRes.status}: ${release ? JSON.stringify(release) : '(no body)'}`)
  }

  // Wrong-project safety: the release resource's own `name` (and its
  // rulesetName) must explicitly contain the EXACT requested projectId
  // — never trust a response shape without checking it actually
  // describes the project that was asked about.
  const expectedPrefix = `projects/${projectId}/`
  if (!release || typeof release.name !== 'string' || !release.name.startsWith(expectedPrefix)) {
    throw new RulesVerificationError(`Release response does not clearly identify project "${projectId}" (got name: ${release?.name ?? '(missing)'}) — refusing to trust it.`)
  }
  if (typeof release.rulesetName !== 'string' || !release.rulesetName.startsWith(expectedPrefix)) {
    throw new RulesVerificationError(`Release's rulesetName does not clearly identify project "${projectId}" (got: ${release.rulesetName ?? '(missing)'}) — refusing to trust it.`)
  }

  const rulesetUrl = `${RULES_API_BASE}/${release.rulesetName}`
  const rulesetRes = await fetchImpl(rulesetUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  const ruleset = await rulesetRes.json().catch(() => null)
  if (!rulesetRes.ok) {
    throw new RulesVerificationError(`GET ${release.rulesetName} -> HTTP ${rulesetRes.status}: ${ruleset ? JSON.stringify(ruleset) : '(no body)'}`)
  }
  const files = ruleset?.source?.files
  if (!Array.isArray(files) || files.length === 0 || typeof files[0].content !== 'string') {
    throw new RulesVerificationError('Ruleset response did not contain the expected source.files[0].content shape — cannot verify.')
  }
  return { rulesetName: release.rulesetName, content: files[0].content }
}

// Whitespace/line-ending differences (CRLF vs LF, trailing newline) must
// never register as a false MISMATCH — only actual rule content
// differences matter.
export function normalizeRulesText(text) {
  return text.replace(/\r\n/g, '\n').trim()
}

export function rulesTextsMatch(deployedContent, localContent) {
  return normalizeRulesText(deployedContent) === normalizeRulesText(localContent)
}
