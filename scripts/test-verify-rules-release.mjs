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
  assertProjectMatchesCredential,
  verifyRulesRelease,
  isValidRulesetResourceName,
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

await checkAsync('fetchActiveRulesetContent rejects when ruleset has no source.files (identity is otherwise valid)',
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
      // Identity checks out (name matches release.rulesetName and the
      // project prefix) — this test is specifically about the missing
      // source.files shape, not identity, so name must be well-formed.
      return jsonResponse(200, { name: 'projects/idogs-app-staging/rulesets/abc123', source: {} })
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
        return jsonResponse(200, {
          name: 'projects/idogs-app-staging/rulesets/xyz789',
          source: { files: [{ name: 'firestore.rules', content: RULES_TEXT }] },
        })
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

console.log('--- Section 7: credential/project mismatch fails CLOSED, before any token/network call (Codex round 8) ---')

check('assertProjectMatchesCredential throws when FIREBASE_PROJECT_ID differs from the requested projectId',
  throwsRulesVerificationError(() => assertProjectMatchesCredential({ FIREBASE_PROJECT_ID: 'idogs-app-staging' }, 'idogs-app')))

check('assertProjectMatchesCredential does not throw when they match',
  (() => {
    try {
      assertProjectMatchesCredential({ FIREBASE_PROJECT_ID: 'idogs-app-staging' }, 'idogs-app-staging')
      return true
    } catch {
      return false
    }
  })())

function spyCredentialFactory() {
  const calls = []
  const factory = (opts) => {
    calls.push(opts)
    return { getAccessToken: async () => ({ access_token: 'should-never-be-minted' }) }
  }
  factory.calls = calls
  return factory
}

function spyFetch() {
  const calls = []
  const impl = async (url, opts) => {
    calls.push({ url, opts })
    return jsonResponse(200, { name: 'unexpected', rulesetName: 'unexpected' })
  }
  impl.calls = calls
  return impl
}

await checkAsync('verifyRulesRelease() rejects on project mismatch WITHOUT ever calling the credential factory (executable-path proof)',
  (async () => {
    const credentialFactory = spyCredentialFactory()
    const fetchImpl = spyFetch()
    let threw = false
    try {
      await verifyRulesRelease({
        projectId: 'idogs-app',
        localRulesContent: 'rules_version = \'2\';',
        env: { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'fake' },
        credentialFactory,
        fetchImpl,
      })
    } catch (err) {
      threw = err instanceof RulesVerificationError
    }
    return threw && credentialFactory.calls.length === 0 && fetchImpl.calls.length === 0
  })())

await checkAsync('verifyRulesRelease() rejects on missing env vars WITHOUT ever calling the credential factory or fetch (defense in depth, checked before the project-match assertion too)',
  (async () => {
    const credentialFactory = spyCredentialFactory()
    const fetchImpl = spyFetch()
    let threw = false
    try {
      await verifyRulesRelease({
        projectId: 'idogs-app-staging',
        localRulesContent: 'rules_version = \'2\';',
        env: {},
        credentialFactory,
        fetchImpl,
      })
    } catch (err) {
      threw = err instanceof RulesVerificationError
    }
    return threw && credentialFactory.calls.length === 0 && fetchImpl.calls.length === 0
  })())

await checkAsync('verifyRulesRelease() DOES call the credential factory and fetch, and resolves correctly, once projectId genuinely matches (full happy-path orchestration)',
  (async () => {
    const RULES_TEXT = "rules_version = '2';\nservice cloud.firestore {\n  match /{document=**} { allow read: if true; }\n}\n"
    const credentialFactory = spyCredentialFactory()
    const fetchImpl = (async (url) => {
      if (url.includes('/releases/cloud.firestore')) {
        return jsonResponse(200, {
          name: 'projects/idogs-app-staging/releases/cloud.firestore',
          rulesetName: 'projects/idogs-app-staging/rulesets/xyz789',
        })
      }
      return jsonResponse(200, {
        name: 'projects/idogs-app-staging/rulesets/xyz789',
        source: { files: [{ name: 'firestore.rules', content: RULES_TEXT }] },
      })
    })
    const result = await verifyRulesRelease({
      projectId: 'idogs-app-staging',
      localRulesContent: RULES_TEXT,
      env: { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'fake' },
      credentialFactory,
      fetchImpl,
    })
    return credentialFactory.calls.length === 1 &&
      credentialFactory.calls[0].projectId === 'idogs-app-staging' &&
      result.rulesetName === 'projects/idogs-app-staging/rulesets/xyz789' &&
      result.matches === true
  })())

console.log('--- Section 8: ruleset response identity validation (Codex round 9) ---')

// Shared release mock: always identifies the correct project/rulesetName
// so every test below isolates the SECOND call's (the ruleset GET)
// identity checks specifically, not the already-covered release checks.
function releaseThenRuleset(rulesetResponseBody) {
  return async (url) => {
    if (url.includes('/releases/cloud.firestore')) {
      return jsonResponse(200, {
        name: 'projects/idogs-app-staging/releases/cloud.firestore',
        rulesetName: 'projects/idogs-app-staging/rulesets/xyz789',
      })
    }
    return jsonResponse(200, rulesetResponseBody)
  }
}

const IDENTITY_RULES_TEXT = "rules_version = '2';\nservice cloud.firestore {\n  match /{document=**} { allow read: if true; }\n}\n"

await checkAsync('success mock includes the correct ruleset.name and resolves normally',
  (async () => {
    const result = await fetchActiveRulesetContent(
      'idogs-app-staging',
      'fake-token',
      releaseThenRuleset({
        name: 'projects/idogs-app-staging/rulesets/xyz789',
        source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] },
      }),
    )
    return result.rulesetName === 'projects/idogs-app-staging/rulesets/xyz789' && result.content === IDENTITY_RULES_TEXT
  })())

await checkAsync('missing ruleset.name fails, even with otherwise well-formed source.files',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    releaseThenRuleset({ source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] } }),
  )))

await checkAsync('empty-string ruleset.name fails (falsy but technically present)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    releaseThenRuleset({ name: '', source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] } }),
  )))

await checkAsync('mismatched ruleset name fails (a DIFFERENT ruleset within the SAME project)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    releaseThenRuleset({
      name: 'projects/idogs-app-staging/rulesets/SOME-OTHER-RULESET',
      source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] },
    }),
  )))

await checkAsync('cross-project ruleset name fails (belongs to an entirely different project)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging',
    'fake-token',
    releaseThenRuleset({
      name: 'projects/idogs-app/rulesets/xyz789',
      source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] },
    }),
  )))

await checkAsync('matching text does NOT override an identity failure — content is never even trusted enough to compare',
  (async () => {
    // The ruleset's source content is byte-for-byte identical to what a
    // real local firestore.rules file would contain — proving that a
    // content match alone can never rescue a failed identity check, the
    // identity check must run (and fail closed) BEFORE content is ever
    // looked at.
    let threw = false
    try {
      await fetchActiveRulesetContent(
        'idogs-app-staging',
        'fake-token',
        releaseThenRuleset({
          name: 'projects/idogs-app/rulesets/xyz789', // cross-project — must fail regardless of content below
          source: { files: [{ name: 'firestore.rules', content: IDENTITY_RULES_TEXT }] },
        }),
      )
    } catch (err) {
      threw = err instanceof RulesVerificationError
    }
    return threw
  })())

console.log('--- Section 9: exact ruleset resource-name grammar (Codex round 10) ---')

check('isValidRulesetResourceName accepts a well-formed name',
  isValidRulesetResourceName('projects/idogs-app-staging/rulesets/xyz789', 'idogs-app-staging') === true)

check('isValidRulesetResourceName rejects the wrong resource type (not-rulesets)',
  isValidRulesetResourceName('projects/idogs-app-staging/not-rulesets/xyz', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects an empty ID segment',
  isValidRulesetResourceName('projects/idogs-app-staging/rulesets/', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects an extra trailing path segment',
  isValidRulesetResourceName('projects/idogs-app-staging/rulesets/a/extra', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a leading slash (extra leading path content)',
  isValidRulesetResourceName('/projects/idogs-app-staging/rulesets/xyz', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects trailing path content after the ID (trailing slash)',
  isValidRulesetResourceName('projects/idogs-app-staging/rulesets/xyz/', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a project ID that is only a STRING PREFIX of the actual name (idogs-app vs idogs-app-staging)',
  isValidRulesetResourceName('projects/idogs-app-staging/rulesets/xyz', 'idogs-app') === false)

check('isValidRulesetResourceName rejects a genuinely different (cross-)project',
  isValidRulesetResourceName('projects/idogs-app/rulesets/xyz', 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a non-string identity (null)',
  isValidRulesetResourceName(null, 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a non-string identity (number)',
  isValidRulesetResourceName(123, 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a non-string identity (undefined)',
  isValidRulesetResourceName(undefined, 'idogs-app-staging') === false)

check('isValidRulesetResourceName rejects a malformed string with no recognizable structure',
  isValidRulesetResourceName('not-a-resource-name-at-all', 'idogs-app-staging') === false)

check('isValidRulesetResourceName safely handles a projectId containing regex metacharacters (does not throw, does not accidentally match)',
  (() => {
    // Real Firebase project IDs can never contain these, but the
    // function must not throw or produce a wrong result if one ever
    // did — proves projectId is escaped before being used in a RegExp,
    // not interpolated raw.
    const weird = 'a.b*c'
    return isValidRulesetResourceName(`projects/${weird}/rulesets/xyz`, weird) === true &&
      isValidRulesetResourceName('projects/aXbYc/rulesets/xyz', weird) === false
  })())

// Integration-level proof (through the real fetch/release flow, not
// just the standalone grammar function) that each malformed shape is
// rejected end-to-end, BEFORE any source content is read.
function releaseWithRulesetName(rulesetName) {
  return async (url) => {
    if (url.includes('/releases/cloud.firestore')) {
      return jsonResponse(200, {
        name: 'projects/idogs-app-staging/releases/cloud.firestore',
        rulesetName,
      })
    }
    return jsonResponse(200, {
      name: rulesetName,
      source: { files: [{ name: 'firestore.rules', content: 'rules_version = \'2\';' }] },
    })
  }
}

await checkAsync('fetchActiveRulesetContent rejects release.rulesetName of the wrong resource type (not-rulesets)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging', 'fake-token', releaseWithRulesetName('projects/idogs-app-staging/not-rulesets/xyz'),
  )))

await checkAsync('fetchActiveRulesetContent rejects release.rulesetName with an empty ID segment',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging', 'fake-token', releaseWithRulesetName('projects/idogs-app-staging/rulesets/'),
  )))

await checkAsync('fetchActiveRulesetContent rejects release.rulesetName with extra trailing path segments',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging', 'fake-token', releaseWithRulesetName('projects/idogs-app-staging/rulesets/a/extra'),
  )))

await checkAsync('fetchActiveRulesetContent rejects release.rulesetName with trailing path content (trailing slash)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging', 'fake-token', releaseWithRulesetName('projects/idogs-app-staging/rulesets/xyz/'),
  )))

await checkAsync('fetchActiveRulesetContent rejects a projectId-as-string-prefix mismatch (idogs-app-staging vs idogs-app)',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app', 'fake-token', releaseWithRulesetName('projects/idogs-app-staging/rulesets/xyz'),
  )))

await checkAsync('fetchActiveRulesetContent rejects a non-string release.rulesetName',
  rejectsWithRulesVerificationError(fetchActiveRulesetContent(
    'idogs-app-staging', 'fake-token', async (url) => {
      if (url.includes('/releases/cloud.firestore')) {
        return jsonResponse(200, { name: 'projects/idogs-app-staging/releases/cloud.firestore', rulesetName: 12345 })
      }
      return jsonResponse(200, { source: { files: [{ name: 'firestore.rules', content: 'x' }] } })
    },
  )))

await summary()
