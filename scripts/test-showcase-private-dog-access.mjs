import fs from 'node:fs'
import { canGrantPrivateDogAccess, canManagePrivateDogAccess, effectiveOwnerId, grantAllowsBuyerRead, isSafeDogDocumentPath, normalizeBuyerEmail } from '../api/_lib/private-dog-access.js'

let passed = 0
let failed = 0
function check(name, ok) {
  if (ok) { passed++; console.log(`PASS: ${name}`) }
  else { failed++; console.error(`FAIL: ${name}`) }
}

const dog = { id: 'dog1', tenantId: 'breeder1', currentOwnerId: 'breeder1', depositStatus: 'received' }
const grant = { dogId: 'dog1', buyerEmail: 'buyer@example.com', grantedByUid: 'breeder1', status: 'active' }

check('buyer email is normalized before storage/comparison', normalizeBuyerEmail(' Buyer@Example.COM ') === 'buyer@example.com')
check('non-string buyer email normalizes safely', normalizeBuyerEmail(null) === '')
check('modern dog effective owner comes from currentOwnerId', effectiveOwnerId({ tenantId: 'old', currentOwnerId: 'new' }) === 'new')
check('legacy dog effective owner falls back to tenantId', effectiveOwnerId({ tenantId: 'legacy' }) === 'legacy')
check('current owner can manage a private grant', canManagePrivateDogAccess(dog, 'breeder1'))
check('non-owner cannot manage a private grant', !canManagePrivateDogAccess(dog, 'attacker'))
check('claimed buyer cannot turn breeder pre-transfer grants back on', !canManagePrivateDogAccess({ ...dog, currentOwnerId: 'newOwner' }, 'newOwner'))
check('deposit received allows grant', canGrantPrivateDogAccess(dog, 'breeder1'))
check('deposit pending blocks grant', !canGrantPrivateDogAccess({ ...dog, depositStatus: 'pending' }, 'breeder1'))
check('no deposit blocks grant', !canGrantPrivateDogAccess({ ...dog, depositStatus: 'none' }, 'breeder1'))
check('matching verified buyer email reads active grant', grantAllowsBuyerRead(grant, dog, 'BUYER@example.com'))
check('wrong buyer email is denied', !grantAllowsBuyerRead(grant, dog, 'other@example.com'))
check('revoked grant is denied', !grantAllowsBuyerRead({ ...grant, status: 'revoked' }, dog, 'buyer@example.com'))
check('grant for another Dog ID is denied', !grantAllowsBuyerRead({ ...grant, dogId: 'dog2' }, dog, 'buyer@example.com'))
check('old breeder grant dies automatically after ownership changes', !grantAllowsBuyerRead(grant, { ...dog, currentOwnerId: 'newOwner' }, 'buyer@example.com'))
check('pending transfer to the same granted buyer keeps private access until claim', grantAllowsBuyerRead(grant, { ...dog, status: 'transferred', buyerEmail: 'buyer@example.com' }, 'buyer@example.com'))
check('pending transfer to a different buyer immediately kills the old grant', !grantAllowsBuyerRead(grant, { ...dog, status: 'transferred', buyerEmail: 'newbuyer@example.com' }, 'buyer@example.com'))
check('document path for this dog and breeder is safe', isSafeDogDocumentPath('documents/breeder1/dog1/file.pdf', dog))
check('document path for another dog is denied', !isSafeDogDocumentPath('documents/breeder1/dog2/file.pdf', dog))
check('document path for unrelated tenant is denied', !isSafeDogDocumentPath('documents/other/dog1/file.pdf', dog))
check('non-document storage path is denied', !isSafeDogDocumentPath('showcase/breeder1/dog1/file.pdf', dog))

const manageSrc = fs.readFileSync(new URL('../api/manage-private-dog-access.js', import.meta.url), 'utf8')
const viewSrc = fs.readFileSync(new URL('../api/private-dog-view.js', import.meta.url), 'utf8')
const rulesSrc = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const appSrc = fs.readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')
const littersSrc = fs.readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
const publicSrc = fs.readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
const protectedSrc = fs.readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')
const loginSrc = fs.readFileSync(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8')
const signupSrc = fs.readFileSync(new URL('../src/pages/SignupPage.tsx', import.meta.url), 'utf8')
const verifySrc = fs.readFileSync(new URL('../src/pages/VerifyEmailPage.tsx', import.meta.url), 'utf8')
const returnToSrc = fs.readFileSync(new URL('../src/lib/returnTo.ts', import.meta.url), 'utf8')

check('grant endpoint gates grant on canGrantPrivateDogAccess', /canGrantPrivateDogAccess\(dog, uid\)/.test(manageSrc))
check('buyer endpoint requires Firebase verified email', /decoded\.email_verified !== true/.test(viewSrc))
check('buyer endpoint authorizes via grantAllowsBuyerRead', /grantAllowsBuyerRead\(grantSnap\.data\(\), dog, decoded\.email\)/.test(viewSrc))
check('buyer endpoint does not query litter documents', !/collection\(['"]litters['"]\)/.test(viewSrc))
check('buyer endpoint signs only validated document paths', /isSafeDogDocumentPath\(path, dog\)/.test(viewSrc))
check('private media/document signed URLs are short-lived (5 minutes)', /PRIVATE_URL_TTL_MS = 5 \* 60 \* 1000/.test(viewSrc))
check('dogPrivateAccess collection is denied to direct Firestore clients', /match \/dogPrivateAccess\/\{dogId\}[\s\S]*?allow read, write: if false;/.test(rulesSrc))
check('private puppy page lives inside the protected /app route', /<Route path="shared-dogs\/:dogId" element=\{<PrivateDogPage \/>\}/.test(appSrc))
check('Showcase UI only offers active grant control after deposit received', /puppy\.depositStatus === 'received'/.test(littersSrc) && /Grant private access/.test(littersSrc))
check('Showcase UI supports revoke and copy-link actions', /revokePrivateAccess\(puppy\)/.test(littersSrc) && /copyPrivateAccessLink\(puppy\)/.test(littersSrc))
check('public Showcase still selects only entry.visible === true puppies', /filter\(\(\[, entry\]\) => entry\?\.visible === true\)/.test(publicSrc))
check('public Showcase litter projection does not return total puppyIds', !/const litter = \{[\s\S]*?puppyIds[\s\S]*?\n\s*\}/.test(publicSrc))
check('ProtectedRoute preserves the requested private dog path through sign-in', /next=\$\{encodeURIComponent\(returnTo\)\}/.test(protectedSrc))
check('login returns the buyer to the validated requested app path', /safeAppReturnTo/.test(loginSrc) && /navigate\(returnTo/.test(loginSrc))
check('signup carries the requested app path into email verification', /verify-email\?next=\$\{encodeURIComponent\(returnTo\)\}/.test(signupSrc))
check('email verification returns the buyer to the requested private dog path', /safeAppReturnTo/.test(verifySrc) && /navigate\(returnTo/.test(verifySrc))
check('post-auth redirect is constrained to internal /app routes', /startsWith\('\/app\/'\)/.test(returnToSrc) && /includes\('\:\/\/'\)/.test(returnToSrc))

// =========================================================================
// Staging QA fix-round: stale Firebase ID-token bug. reload() (used by
// useAuth.tsx's checkEmailVerified()) only refreshes the LOCAL profile
// flag (user.emailVerified) — never the cached ID TOKEN's own embedded
// email_verified claim, which is what api/private-dog-view.js actually
// authorizes against. A buyer redirected straight into a protected page
// (e.g. /app/shared-dogs/:dogId) immediately after verifying got a false
// 403 on their very first fetch. Fix: force a fresh token
// (getIdToken(true)) once reload() confirms verified===true, BEFORE
// exposing that state to anything that could redirect on it.
//
// checkEmailVerified() lives inside AuthProvider's component closure
// (not exported standalone), so — matching this codebase's own
// established pattern for exactly this constraint (see e.g.
// scripts/test-showcase-public-page.mjs's Section 2 header comment) —
// Section A below proves the REAL source has the exact required shape
// via position-based inspection; Section B behaviorally proves that
// shape via a harness with the identical control flow, mocked
// reload/getIdToken/setUser (no real Firebase, no DOM).
// =========================================================================

// ── Section A: source inspection of the real fix ──
{
  const authSrc = fs.readFileSync(new URL('../src/hooks/useAuth.tsx', import.meta.url), 'utf8')

  const fnStart = authSrc.indexOf('async function checkEmailVerified')
  const reloadIdx = authSrc.indexOf('await reload(auth.currentUser)', fnStart)
  const verifiedIdx = authSrc.indexOf('const verified = auth.currentUser.emailVerified', fnStart)
  const refreshIdx = authSrc.indexOf('await auth.currentUser.getIdToken(true)', fnStart)
  const setUserIdx = authSrc.indexOf('setUser(auth.currentUser)', fnStart)

  check('checkEmailVerified: all four key statements (reload, verified check, forced token refresh, setUser) were located in source',
    fnStart > -1 && reloadIdx > -1 && verifiedIdx > -1 && refreshIdx > -1 && setUserIdx > -1)
  check('the forced token refresh (getIdToken(true)) happens strictly AFTER reload() and the verified check — never before, never speculatively',
    reloadIdx < verifiedIdx && verifiedIdx < refreshIdx)
  check('the forced token refresh happens strictly BEFORE setUser() — setUser() is what makes emailVerified visible to ProtectedRoute and VerifyEmailPage\'s own redirect effect, so gating it behind a successful refresh is what prevents a redirect into a page backed by a stale token',
    refreshIdx < setUserIdx)
  check('the forced refresh is gated on `if (verified)` — never called unconditionally (an unverified user never needs, and must never trigger, a forced refresh)',
    /if \(verified\) \{\s*\n\s*await auth\.currentUser\.getIdToken\(true\)\s*\n\s*\}/.test(authSrc))
  check('no local try/catch swallows a forced-refresh failure inside checkEmailVerified — a throw here must propagate to the caller (VerifyEmailPage\'s own catch), never be silently treated as "not verified" or, worse, "verified"',
    !/getIdToken\(true\)[\s\S]{0,10}\}\s*catch/.test(authSrc.slice(fnStart, setUserIdx + 50)))
  check('getIdToken is called with forceRefresh=true explicitly, never a bare getIdToken() that would return the same stale cached token',
    /getIdToken\(true\)/.test(authSrc))

  // Requirement 4: the fix must live at the auth-state boundary, not by
  // broadly forcing every private-dog API request to refresh — db.ts's
  // getPrivateDogView()/managePrivateDogAccess() must remain untouched
  // (still calling the bare, non-forcing getIdToken()).
  const dbSrc = fs.readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('[req 4] db.ts\'s getPrivateDogView() still uses the bare getIdToken() (no forceRefresh) — the fix is NOT a broad "always force-refresh" change to every private-dog request',
    /export async function getPrivateDogView[\s\S]{0,300}getIdToken\(\)/.test(dbSrc) && !/export async function getPrivateDogView[\s\S]{0,300}getIdToken\(true\)/.test(dbSrc))
  check('[req 4] db.ts\'s managePrivateDogAccess() likewise still uses the bare getIdToken()',
    /export async function managePrivateDogAccess[\s\S]{0,400}getIdToken\(\)/.test(dbSrc) && !/export async function managePrivateDogAccess[\s\S]{0,400}getIdToken\(true\)/.test(dbSrc))

  // Requirement 5: the `next`/returnTo plumbing this fix must not
  // disturb is entirely unchanged — re-confirm the exact same checks
  // already proven earlier in this file still hold against the current
  // source (regression, not new coverage).
  const verifySrc = fs.readFileSync(new URL('../src/pages/VerifyEmailPage.tsx', import.meta.url), 'utf8')
  check('[req 5 regression] VerifyEmailPage.tsx still redirects to the exact `returnTo` (the requested private Dog ID path) on success — untouched by this fix',
    /navigate\(returnTo, \{ replace: true \}\)/.test(verifySrc))
  check('[req 5 regression] VerifyEmailPage.tsx\'s handleCheck() still shows an error rather than redirecting when checkEmailVerified() resolves falsy',
    /if \(verified\) \{[\s\S]{0,120}navigate\(returnTo/.test(verifySrc) && /\} else \{[\s\S]{0,80}Not verified yet/.test(verifySrc))
  check('[req 6 regression] handleCheck()\'s try/catch still reports a genuine failure (now including a thrown forced-refresh error) via the existing, accurate "Could not check verification status" message — never silently treated as success',
    /catch \{[\s\S]{0,100}Could not check verification status/.test(verifySrc))
}

// ── Section B: behavioral harness mirroring checkEmailVerified()'s
// exact control flow (mocked reload/getIdToken/setUser — no real
// Firebase, no DOM, no network) ──
{
  function makeMockUser(initialVerified) {
    return { emailVerified: initialVerified, getIdToken: async () => 'mock-token' }
  }

  // Mirrors the fixed function body EXACTLY (see Section A's own
  // position assertions proving the real file matches this shape).
  async function checkEmailVerifiedHarness(currentUser, mockReload, setUserSpy) {
    if (!currentUser) return false
    await mockReload(currentUser)
    const verified = currentUser.emailVerified
    if (verified) {
      await currentUser.getIdToken(true)
    }
    setUserSpy(currentUser)
    return verified
  }

  check('[B1] unverified cached token: reload confirms still-unverified, no forced refresh is attempted, returns false', await (async () => {
    const user = makeMockUser(false)
    let refreshCalled = false
    user.getIdToken = async (force) => { if (force) refreshCalled = true; return 'tok' }
    let setUserCalled = false
    const result = await checkEmailVerifiedHarness(user, async () => {}, () => { setUserCalled = true })
    return result === false && !refreshCalled && setUserCalled === true
  })())

  check('[B2] reload confirms verification (mockReload flips emailVerified true) — forced token refresh is attempted before setUser, returns true', await (async () => {
    const user = makeMockUser(false)
    const callOrder = []
    user.getIdToken = async (force) => { callOrder.push(`getIdToken(${force})`); return 'fresh-token' }
    const mockReload = async u => { u.emailVerified = true } // simulates the real reload() mutating auth.currentUser in place
    const result = await checkEmailVerifiedHarness(user, mockReload, () => callOrder.push('setUser'))
    return result === true &&
      callOrder.length === 2 &&
      callOrder[0] === 'getIdToken(true)' &&
      callOrder[1] === 'setUser'
  })())

  check('[B3] forced refresh happens strictly BEFORE setUser — setUser is never called before the refresh resolves (proves the redirect-enabling state update cannot race ahead of a fresh token)', await (async () => {
    const user = makeMockUser(true)
    let refreshResolvedBeforeSetUser = null
    let refreshResolved = false
    user.getIdToken = async () => { await Promise.resolve(); refreshResolved = true; return 'fresh-token' }
    await checkEmailVerifiedHarness(user, async () => {}, () => { refreshResolvedBeforeSetUser = refreshResolved })
    return refreshResolvedBeforeSetUser === true
  })())

  check('[B4] refresh failure does NOT allow protected content: a thrown getIdToken(true) propagates (never swallowed into a false "not verified" return), and setUser is NEVER called — so nothing downstream can treat this as verified', await (async () => {
    const user = makeMockUser(true)
    user.getIdToken = async () => { throw new Error('network error during forced refresh') }
    let setUserCalled = false
    let threw = false
    try {
      await checkEmailVerifiedHarness(user, async () => {}, () => { setUserCalled = true })
    } catch {
      threw = true
    }
    return threw === true && setUserCalled === false
  })())

  check('[B5] no currentUser: returns false immediately, reload/getIdToken/setUser are never called (unchanged pre-existing guard)', await (async () => {
    let reloadCalled = false
    let setUserCalled = false
    const result = await checkEmailVerifiedHarness(null, async () => { reloadCalled = true }, () => { setUserCalled = true })
    return result === false && !reloadCalled && !setUserCalled
  })())
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
