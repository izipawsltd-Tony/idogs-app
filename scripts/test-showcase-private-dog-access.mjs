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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
