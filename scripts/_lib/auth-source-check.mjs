import { readFileSync } from 'node:fs'
const implementation = readFileSync(new URL('../../api/_lib/account-onboarding.js', import.meta.url), 'utf8')
// Source audits must follow the shared verifier, not merely accept a renamed
// call. Behavioral Auth/readiness checks also run in the emulator workflow.
export function hasFirebaseAccountAuth(source) {
  const imported = /import\s*\{\s*verifyAccountToken\s*\}\s*from\s*['"](?:\.\/_lib\/|\.\/|\.\.\/_lib\/)account-onboarding\.js['"]/.test(source)
  const awaited = /await\s+verifyAccountToken\(\s*idToken\s*[,)]/.test(source)
  const sdkBacked = implementation.includes('return auth.verifyIdToken(token)') && implementation.includes('await auth.verifyIdToken(token, true)')
  const managementGated = implementation.includes('await auth.getUser(identity.uid)') && implementation.includes("throw fail(403, 'account/setup-required')") && implementation.includes('identity.firebase?.sign_in_provider')
  return imported && awaited && sdkBacked && managementGated
}
