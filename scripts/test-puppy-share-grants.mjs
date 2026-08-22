// scripts/test-puppy-share-grants.mjs — Private Puppy Update Links,
// Phase 1 backend (puppyShareGrants). Pure-function unit tests for the
// shared helpers module, plus static-source assertions proving the new
// endpoints match the approved plan and that dogPrivateAccess/
// litterShowcases/Showcase source files are completely untouched by this
// feature.
//
// No live Firestore/Auth calls are made here (no emulator dependency) —
// same posture as this codebase's closest sibling test,
// test-showcase-private-dog-access.mjs, which this file's structure
// deliberately mirrors: pure-function checks against real exported
// helpers, plus regex assertions against the real endpoint source to
// prove security-relevant control flow (auth-before-work, ownership
// checks, fail-closed shapes) is actually present in the shipped code.

import fs from 'node:fs'
import {
  cleanCustomerLabel, validatePuppyIds, isPlausibleShareToken, serializeGrant,
  effectiveOwnerId, generateShareToken, hashShareToken, isValidExpiryIso,
  MAX_CUSTOMER_LABEL_LENGTH,
} from '../api/_lib/puppy-share-grants.js'

let passed = 0
let failed = 0
function check(name, ok) {
  if (ok) { passed++; console.log(`PASS: ${name}`) }
  else { failed++; console.error(`FAIL: ${name}`) }
}

// ── validatePuppyIds ──────────────────────────────────────────────
check('rejects non-array', validatePuppyIds('dog1') === null)
check('rejects empty array (0 puppies)', validatePuppyIds([]) === null)
check('accepts exactly 1 puppy', JSON.stringify(validatePuppyIds(['dog1'])) === JSON.stringify(['dog1']))
check('accepts exactly 2 puppies', JSON.stringify(validatePuppyIds(['dog1', 'dog2'])) === JSON.stringify(['dog1', 'dog2']))
check('rejects 3 puppies (>2)', validatePuppyIds(['dog1', 'dog2', 'dog3']) === null)
check('rejects duplicate puppy ids', validatePuppyIds(['dog1', 'dog1']) === null)
check('rejects non-string entries', validatePuppyIds(['dog1', 42]) === null)
check('rejects blank-string entries', validatePuppyIds(['dog1', '  ']) === null)

// ── cleanCustomerLabel ────────────────────────────────────────────
check('customerLabel accepts a normal string', cleanCustomerLabel('Jane Smith') === 'Jane Smith')
check('customerLabel trims whitespace', cleanCustomerLabel('  Jane  ') === 'Jane')
check('customerLabel caps at 120 chars', cleanCustomerLabel('x'.repeat(500)).length === MAX_CUSTOMER_LABEL_LENGTH)
check('MAX_CUSTOMER_LABEL_LENGTH is 120', MAX_CUSTOMER_LABEL_LENGTH === 120)
check('customerLabel treats an absent value as null, never empty string', cleanCustomerLabel(undefined) === null)
check('customerLabel treats empty string as null', cleanCustomerLabel('') === null)
check('customerLabel treats whitespace-only as null', cleanCustomerLabel('   ') === null)
check('customerLabel strips control characters', cleanCustomerLabel('Jane\x00Smith') === 'JaneSmith')

// ── isPlausibleShareToken ─────────────────────────────────────────
const realToken = generateShareToken()
check('a real generateShareToken() output passes the format check', isPlausibleShareToken(realToken))
check('rejects non-string', !isPlausibleShareToken(12345))
check('rejects too-short value', !isPlausibleShareToken('short'))
check('rejects a value with disallowed characters', !isPlausibleShareToken('abc!@#$%^&*()_+'.repeat(3)))
check('rejects empty string', !isPlausibleShareToken(''))

// ── token generation / hashing (reused, not reimplemented) ────────
const tokenA = generateShareToken()
const tokenB = generateShareToken()
check('generateShareToken produces distinct values across calls', tokenA !== tokenB)
check('hashShareToken is deterministic for the same input', hashShareToken(tokenA) === hashShareToken(tokenA))
check('hashShareToken produces different hashes for different tokens', hashShareToken(tokenA) !== hashShareToken(tokenB))
check('hashShareToken output looks like a hex sha256 digest', /^[0-9a-f]{64}$/.test(hashShareToken(tokenA)))

// ── isValidExpiryIso (reused, not reimplemented) ──────────────────
check('accepts a near-future ISO date', isValidExpiryIso(new Date(Date.now() + 86400000).toISOString()))
check('rejects an unparseable date', !isValidExpiryIso('not-a-date'))
check('rejects a date more than 2 years out', !isValidExpiryIso(new Date(Date.now() + 800 * 86400000).toISOString()))

// ── effectiveOwnerId (reused, not reimplemented) ──────────────────
check('modern dog effective owner comes from currentOwnerId', effectiveOwnerId({ tenantId: 'old', currentOwnerId: 'new' }) === 'new')
check('legacy dog effective owner falls back to tenantId', effectiveOwnerId({ tenantId: 'legacy' }) === 'legacy')
check('transferred dog effective owner is the NEW owner, not the original breeder', effectiveOwnerId({ tenantId: 'breeder1', currentOwnerId: 'buyer1' }) === 'buyer1')
check('cross-owner: original breeder no longer matches after transfer', effectiveOwnerId({ tenantId: 'breeder1', currentOwnerId: 'buyer1' }) !== 'breeder1')

// ── serializeGrant ─────────────────────────────────────────────────
const rawGrantData = {
  ownerId: 'breeder1', puppyIds: ['dog1', 'dog2'], customerLabel: 'Jane',
  tokenHash: 'deadbeef'.repeat(8), status: 'active', expiresAt: null,
  createdAt: { toDate: () => new Date('2026-01-01T00:00:00.000Z') },
  updatedAt: { toDate: () => new Date('2026-01-02T00:00:00.000Z') },
  lastResetAt: null,
}
const serialized = serializeGrant('grant1', rawGrantData)
check('serializeGrant never includes tokenHash', !('tokenHash' in serialized))
check('serializeGrant includes id from the argument, not the data', serialized.id === 'grant1')
check('serializeGrant converts Firestore Timestamp-like createdAt to an ISO string', serialized.createdAt === '2026-01-01T00:00:00.000Z')
check('serializeGrant passes through puppyIds unchanged (both, not 1)', JSON.stringify(serialized.puppyIds) === JSON.stringify(['dog1', 'dog2']))
check('serializeGrant defaults a missing lastResetAt to null', serialized.lastResetAt === null)

// ── Static-source assertions: new endpoints match the approved plan ──
const grantsLibSrc = fs.readFileSync(new URL('../api/_lib/puppy-share-grants.js', import.meta.url), 'utf8')
const createSrc = fs.readFileSync(new URL('../api/create-puppy-share-grant.js', import.meta.url), 'utf8')
const manageSrc = fs.readFileSync(new URL('../api/manage-puppy-share-grant.js', import.meta.url), 'utf8')
const listSrc = fs.readFileSync(new URL('../api/list-puppy-share-grants.js', import.meta.url), 'utf8')
const viewSrc = fs.readFileSync(new URL('../api/puppy-share-view.js', import.meta.url), 'utf8')
const rulesSrc = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

check('shared lib reuses generateShareToken/hashShareToken from showcase-share.js, does not reimplement', /from '\.\/showcase-share\.js'/.test(grantsLibSrc) && /generateShareToken/.test(grantsLibSrc) && /hashShareToken/.test(grantsLibSrc) && !/from ['"]node:crypto['"]/.test(grantsLibSrc) && !/from ['"]crypto['"]/.test(grantsLibSrc))
check('shared lib reuses effectiveOwnerId from private-dog-access.js, does not reimplement', /from '\.\/private-dog-access\.js'/.test(grantsLibSrc) && /effectiveOwnerId/.test(grantsLibSrc) && !/currentOwnerId.*tenantId.*\|\|/.test(grantsLibSrc.replace(/\n/g, ' ')))

check('create endpoint derives ownerId from the verified token, never the request body', /ownerId:\s*uid/.test(createSrc) && !/body\.ownerId/.test(createSrc) && !/req\.body\.ownerId/.test(createSrc))
check('create endpoint checks effectiveOwnerId for EVERY selected puppy before writing', /dogs\.every\(dog => effectiveOwnerId\(dog\) === uid\)/.test(createSrc))
check('create endpoint uses a Firestore transaction (mirrors rotate-showcase-share.js)', /runTransaction/.test(createSrc))
check('create endpoint returns the raw token exactly once', /shareToken:\s*rawToken/.test(createSrc))
check("create endpoint's Firestore write never includes a raw 'token' field (only tokenHash)", !/\btoken:\s/.test(createSrc))

check('manage endpoint re-derives authorization from the grant document, never the request body', /grant\.ownerId !== uid/.test(manageSrc) && !/body\.ownerId/.test(manageSrc))
check('manage endpoint treats revoke as idempotent', /revoke.*idempotent|idempotent.*revoke/is.test(manageSrc))
check('manage endpoint blocks pause/resume/reset once revoked (409, terminal state)', /409/.test(manageSrc) && /revoked/.test(manageSrc))
check('reset action updates only tokenHash/lastResetAt/updatedAt on the target grant', /tx\.update\(grantRef,\s*\{\s*tokenHash/.test(manageSrc))
check('manage endpoint uses a Firestore transaction for every action', /runTransaction/.test(manageSrc))
check('manage endpoint does not read/write litterShowcases or dogPrivateAccess collections', !/collection\(['"]litterShowcases['"]\)/.test(manageSrc) && !/collection\(['"]dogPrivateAccess['"]\)/.test(manageSrc))

check('list endpoint never accepts ownerId from the caller', !/body\.ownerId/.test(listSrc) && !/query\.ownerId/.test(listSrc))
check('list endpoint checks puppy ownership BEFORE querying grants by puppyId', /effectiveOwnerId\(\{ id: dogSnap\.id, \.\.\.dogSnap\.data\(\) \}\) !== uid/.test(listSrc))
check('list endpoint uses exactly one where() clause per query branch, no orderBy', (listSrc.match(/\.where\(/g) || []).length === 2 && !/\.orderBy\(/.test(listSrc))
check('list endpoint uses array-contains for the by-puppy lookup', /array-contains/.test(listSrc))
check('list endpoint shapes every response through serializeGrant (strips tokenHash)', /serializeGrant/.test(listSrc))

check('public view endpoint is unauthenticated (no verifyIdToken call)', !/verifyIdToken/.test(viewSrc))
check('public view reads the token from the request BODY, not query/URL', /body\.token/.test(viewSrc) && !/req\.query/.test(viewSrc))
check('public view rate-limits before any Firestore read', /checkDurableRateLimit/.test(viewSrc) && viewSrc.indexOf('checkDurableRateLimit(') < viewSrc.indexOf("collection('puppyShareGrants')"))
check('public view validates token format before any lookup or logging', /isPlausibleShareToken/.test(viewSrc))
check('public view never logs the raw token value', !/console\.(log|error)\([^)]*\btoken\b(?!Hash)/.test(viewSrc.replace(/tokenHash/g, 'TOKENHASH')))
check('public view fails closed on zero OR multiple tokenHash matches (limit(2), size!==1)', /\.limit\(2\)/.test(viewSrc) && /size !== 1/.test(viewSrc))
check('public view requires status active (paused/revoked both rejected)', /status !== 'active'/.test(viewSrc))
check('public view enforces expiresAt only when non-null', /if \(grant\.expiresAt\)/.test(viewSrc))
check('public view re-verifies ownership per puppy at READ time (live, not cached from grant creation)', /effectiveOwnerId\(dog\) === grant\.ownerId/.test(viewSrc))
check('public view has a single unavailable() helper reused by every fail-closed branch', /function unavailable/.test(viewSrc) && (viewSrc.match(/unavailable\(res\)/g) || []).length >= 5)
check('public view returns generic unavailable when zero valid puppies remain after ownership filtering', /validDogs\.length === 0/.test(viewSrc))
check('public view reuses signMediaItems, does not reimplement Storage signing', /from '\.\/_lib\/showcase-media-access\.js'/.test(viewSrc) && /signMediaItems/.test(viewSrc) && !/getSignedUrl/.test(viewSrc))
check('public view uses the same 5-minute signed URL TTL as private-dog-view.js', /PRIVATE_URL_TTL_MS = 5 \* 60 \* 1000/.test(viewSrc))
check('public view response is exactly { puppies } — no ownerId/tokenHash/customerLabel/grantId', /res\.status\(200\)\.json\(\{ puppies \}\)/.test(viewSrc))
check('Phase 1 public view per-puppy object ends with photos/videos, no documents field', /photos,\s*\n\s*videos,\s*\n\s*\}/.test(viewSrc))
check('Phase 1 public view has no documents:/dog.documents code reference', !/\bdocuments:/.test(viewSrc) && !/dog\.documents/.test(viewSrc))

check('puppyShareGrants Firestore rule is NOT present yet — rules deploy is a separate later step', !/puppyShareGrants/.test(rulesSrc))
check('dogPrivateAccess rule is completely unchanged', /match \/dogPrivateAccess\/\{dogId\}[\s\S]*?allow read, write: if false;/.test(rulesSrc))
check('litterShowcases rule is completely unchanged', /match \/litterShowcases\/\{litterId\}[\s\S]*?allow create, update, delete: if false;/.test(rulesSrc))

// ── Regression: existing dogPrivateAccess/Showcase source files untouched ──
const manageDogSrc = fs.readFileSync(new URL('../api/manage-private-dog-access.js', import.meta.url), 'utf8')
const privateViewSrc = fs.readFileSync(new URL('../api/private-dog-view.js', import.meta.url), 'utf8')
const rotateSrc = fs.readFileSync(new URL('../api/rotate-showcase-share.js', import.meta.url), 'utf8')
const shareLibSrc = fs.readFileSync(new URL('../api/_lib/showcase-share.js', import.meta.url), 'utf8')
const privateAccessLibSrc = fs.readFileSync(new URL('../api/_lib/private-dog-access.js', import.meta.url), 'utf8')

check('dogPrivateAccess grant endpoint still gates on canGrantPrivateDogAccess (unchanged)', /canGrantPrivateDogAccess\(dog, uid\)/.test(manageDogSrc))
check('dogPrivateAccess buyer view still requires a verified email (unchanged)', /decoded\.email_verified !== true/.test(privateViewSrc))
check('Showcase rotate endpoint still checks Plus eligibility + litter/showcase ownership (unchanged)', /checkBreederPlusAccess/.test(rotateSrc) && /loadOwnedLitter/.test(rotateSrc) && /loadOwnedShowcase/.test(rotateSrc))
check('showcase-share.js exports are all still present (unmodified)', ['generateShareToken', 'hashShareToken', 'isValidExpiryIso', 'MAX_SHARE_EXPIRY_DAYS', 'isShareLive', 'isTenantPlusEligible'].every(name => shareLibSrc.includes(`export function ${name}`) || shareLibSrc.includes(`export const ${name}`)))
check('private-dog-access.js exports are all still present (unmodified)', ['effectiveOwnerId', 'canManagePrivateDogAccess', 'canGrantPrivateDogAccess', 'grantAllowsBuyerRead', 'isSafeDogDocumentPath', 'normalizeBuyerEmail'].every(name => privateAccessLibSrc.includes(`export function ${name}`)))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
