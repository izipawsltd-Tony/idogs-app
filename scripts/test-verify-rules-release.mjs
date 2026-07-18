// scripts/test-verify-rules-release.mjs — mocked tests for
// scripts/_lib/rules-release-verifier.mjs (Codex round 7, Blocker 2).
//
// Exercises the failure modes the round-7 task explicitly requires:
// missing tooling/auth (env preflight), wrong project, failed token
// acquisition, API failure, and a successful read-only comparison. No
// real network access, no real service account keys, no real Firebase
// project — every external dependency (the credential object, fetch)
// is a hand-built fake.

import { makeChecker } from './_lib/test-check.mjs'
import {
  checkRequiredEnvVars,
  getAccessToken,
  fetchActiveRulesetContent,
  normalizeRulesText,
  rulesTextsMatch,
  RulesVerificationError,
} from './_lib/rules-release-verifier.mjs'

const { check, checkAsync, summary } = makeChecker()

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function throwsRulesVerificationError(fn) {
  try {
    fn()
    return false
  } catch (err) {
    return err instanceof RulesVerificationError
  }
}

async function rejectsWithRulesVerificationError(promise) {
  try {
    await promise
    return false
  } catch (err) {
    return err instanceof RulesVerificationError
  }
}

console.log('--- Section 1: missing tooling/auth (env preflight) ---')

check('all three env vars missing throws RulesVerificationError',
  throwsRulesVerificationError(() => checkRequiredEnvVars({})))

check('partial env vars (missing PRIVATE_KEY) throws RulesVerificationError',
  throwsRulesVerificationError(() => checkRequiredEnvVars({
    FIREBASE_PROJECT_ID: 'idogs-app-staging',
    FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  })))

check('missing env vars error message names the missing keys, not values', (() => {
  try {
    checkRequiredEnvVars({ FIREBASE_PROJECT_ID: 'idogs-app-staging' })
    return false
  } catch (err) {
    return err.message.includes('FIREBASE_CLIENT_EMAIL') && err.message.includes('FIREBASE_PRIVATE_KEY')
  }
})())

check('all three env vars present does not throw', (() => {
  try {
    checkRequiredEnvVars({
      FIREBASE_PROJECT_ID: 'idogs-app-staging',
      FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    })
    return true
  } catch {
    return false
  }
})())

console.log('--- Section 2: failed token acquisition ---')

await checkAsync('getAccessToken rejects when credential.getAccessToken() throws',
  rejectsWithRulesVerificationError(getAccessToken({
    getAccessToken: async () => { throw new Error('service account disabled') },
  })))

await checkAsync('getAccessToken rejects when credential returns no access_token field',
  rejectsWithRulesVerificationError(getAccessToken({
    getAccessToken: async () => ({ expires_in: 3600 }),
  })))

await checkAsync('getAccessToken rejects when credential returns empty access_token',
  rejectsWithRulesVerificationError(getAccessToken({
    getAccessToken: async () => ({ access_token: '' }),
  })))

await checkAsync('getAccessToken resolves with the token string on success',
  (async () => {
    const token = await getAccessToken({ getAccessToken: async () => ({ access_token: 'fake-token-abc', expires_in: 3600 }) })
    return token === 'fake-token-abc'
  })())

console.log('--- Section 3: API failure (non-2xx responses) ---')

await checkAsync('fetchActiveRulesetContent rejects when the release GET returns non-2xx',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    async () => jsonResponse(403, { error: { message: 'permission denied' } }),
  )))

await checkAsync('fetchActiveRulesetContent rejects when the ruleset GET returns non-2xx',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    (async (url) => {
      if (url.includes('/releases/cloud.firestore')) {
        return jsonResponse(200, {
          name: 'projects/idogs-app-staging/releases/cloud.firestore',
          rulesetName: 'projects/idogs-app-staging/rulesets/abc123',
        })
      }
      return jsonResponse(500, { error: { message: 'internal error' } })
    }),
  )))

console.log('--- Section 4: wrong-project safety ---')

await checkAsync('fetchActiveRulesetContent rejects when release.name identifies a different project',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    async () => jsonResponse(200, {
      name: 'projects/idogs-app/releases/cloud.firestore',
      rulesetName: 'projects/idogs-app/rulesets/abc123',
    }),
  )))

await checkAsync('fetchActiveRulesetContent rejects when rulesetName identifies a different project',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    async () => jsonResponse(200, {
      name: 'projects/idogs-app-staging/releases/cloud.firestore',
      rulesetName: 'projects/idogs-app/rulesets/abc123',
    }),
  )))

await checkAsync('fetchActiveRulesetContent rejects when release response is malformed (missing name)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    async () => jsonResponse(200, {}),
  )))

console.log('--- Section 5: malformed ruleset shape ---')

await checkAsync('fetchActiveRulesetContent rejects when ruleset has no source.files',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    (async (url) => {
      if (url.includes('/releases/cloud.firestore')) {
        return jsonResponse(200, {
          name: 'projects/idogs-app-staging/releases/cloud.firestore',
          rulesetName: 'projects/idogs-app-staging/rulesets/abc123',
        })
      }
      return jsonResponse(200, { source: {} })
    }),
  )))

console.log('--- Section 6: successful read-only comparison ---')

await checkAsync('fetchActiveRulesetContent resolves with rulesetName + content on a well-formed 2-call success',
  (async () => {
    const RULES_TEXT = "rules_version = '2';\nservice cloud.firestore {\n  match /{document=**} { allow read: if true; }\n}\n"
    let releaseCalled = false
    let rulesetCalled = false
    const result = await fetchActiveRulesetContent(
      'idogs-app-staging',
      'fake-token',
      (async (url, opts) => {
        if (!opts?.headers?.Authorization?.includes('fake-token')) {
          throw new Error('expected Authorization bearer header to carry the token')
        }
        if (url.includes('/releases/cloud.firestore')) {
          releaseCalled = true
          return jsonResponse(200, {
            name: 'projects/idogs-app-staging/releases/cloud.firestore',
            rulesetName: 'projects/idogs-app-staging/rulesets/xyz789',
          })
        }
        rulesetCalled = true
        return jsonResponse(200, { source: { files: [{ name: 'firestore.rules', content: RULES_TEXT }] } })
      }),
    )
    return releaseCalled && rulesetCalled &&
      result.rulesetName === 'projects/idogs-app-staging/rulesets/xyz789' &&
      result.content === RULES_TEXT
  })())

check('normalizeRulesText collapses CRLF to LF and trims',
  normalizeRulesText('  rule A;\r\nrule B;\r\n  ') === 'rule A;\nrule B;')

check('rulesTextsMatch treats CRLF vs LF as identical content',
  rulesTextsMatch('rule A;\r\nrule B;\r\n', 'rule A;\nrule B;\n') === true)

check('rulesTextsMatch reports a genuine content difference as a mismatch',
  rulesTextsMatch('rule A;\n', 'rule B;\n') === false)

summary()
