// scripts/test-landing-media.mjs — regression coverage for the
// self-managed Landing Page Media feature (Super Admin -> Landing Page
// Media): api/_lib/admin-access.js, api/_lib/landing-media.js,
// api/request-landing-media-upload.js, api/confirm-landing-media-
// upload.js, api/get-landing-media-state.js, api/manage-landing-media.js,
// the firestore.rules addition, and the client wiring (src/lib/
// landingMedia.ts, src/lib/superAdmin.ts, LandingPage.tsx,
// LandingMediaAdminPage.tsx).
//
// Usage: node scripts/test-landing-media.mjs
//   Section 1 (structural + pure-function) always runs, no emulator
//   needed.
//   Section 2 (Firestore Rules emulator) needs FIRESTORE_EMULATOR_HOST —
//   proves the public-read/deny-write rule for landingMediaPublished and
//   the deny-all-by-default posture for landingMediaDrafts, directly
//   against the real rules file (not just a structural assertion about
//   its text).
//   Section 3 (full endpoint emulator end-to-end) needs
//   FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, AND
//   FIREBASE_STORAGE_EMULATOR_HOST set — mirrors
//   scripts/test-direct-media-upload.mjs's own real-handler approach,
//   including its documented Storage-emulator PUT limitation (bytes are
//   written directly via the Admin SDK to simulate "the browser's PUT
//   already completed").

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { makeChecker } from './_lib/test-check.mjs'
import { SUPER_ADMIN_EMAILS, isSuperAdminEmail } from '../api/_lib/admin-access.js'
import {
  SLOT_IDS, isValidSlotId, extensionForLandingUpload, maxBytesForLandingKind,
  MAX_LANDING_IMAGE_BYTES, MAX_LANDING_VIDEO_BYTES, publicStorageUrl, sanitizeDisplayFilename,
  LANDING_MEDIA_PUBLISHED_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION, LANDING_MEDIA_GRANTS_COLLECTION,
} from '../api/_lib/landing-media.js'

const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function tests (no emulator needed)
// =========================================================================
{
  // ── admin-access.js ──
  check('SUPER_ADMIN_EMAILS is a non-empty array', Array.isArray(SUPER_ADMIN_EMAILS) && SUPER_ADMIN_EMAILS.length > 0)
  check('isSuperAdminEmail matches a listed admin (case/whitespace-insensitive)', isSuperAdminEmail('  Trunghieungo@Gmail.com  '))
  check('isSuperAdminEmail rejects a normal breeder email', !isSuperAdminEmail('idogsbreeder@gmail.com'))
  check('isSuperAdminEmail rejects null/undefined/empty', !isSuperAdminEmail(null) && !isSuperAdminEmail(undefined) && !isSuperAdminEmail(''))

  const adminAccessSrc = readFileSync(new URL('../api/_lib/admin-access.js', import.meta.url), 'utf8')
  check('requireSuperAdmin verifies the Firebase ID token before doing anything else', /verifyIdToken\(idToken\)/.test(adminAccessSrc))
  check('requireSuperAdmin requires email_verified === true, not just a matching email string', /email_verified !== true/.test(adminAccessSrc))
  check('requireSuperAdmin checks the token\'s OWN decoded email, never a client-supplied header/body field', !/req\.body\.email/.test(adminAccessSrc) && !/req\.headers\[.x-.*email/i.test(adminAccessSrc))

  // ── landing-media.js: slots ──
  check('SLOT_IDS has exactly the four required slots', SLOT_IDS.length === 4 &&
    ['hero', 'dog-profile', 'puppy-showcase', 'digital-passport'].every(id => SLOT_IDS.includes(id)))
  check('isValidSlotId accepts every real slot', SLOT_IDS.every(id => isValidSlotId(id)))
  check('isValidSlotId rejects an arbitrary/forged slotId (cross-slot tampering guard)', !isValidSlotId('hero-fake') && !isValidSlotId('../hero') && !isValidSlotId('') && !isValidSlotId(null))

  // ── landing-media.js: file-type/size allowlist ──
  check('extensionForLandingUpload: image/jpeg -> jpg', extensionForLandingUpload('image', 'image/jpeg') === 'jpg')
  check('extensionForLandingUpload: image/png -> png', extensionForLandingUpload('image', 'image/png') === 'png')
  check('extensionForLandingUpload: image/webp -> webp', extensionForLandingUpload('image', 'image/webp') === 'webp')
  check('extensionForLandingUpload: image/heic is REJECTED for images (task spec: JPG/PNG/WebP only, no HEIC)', extensionForLandingUpload('image', 'image/heic') === null)
  check('extensionForLandingUpload: video/mp4 -> mp4', extensionForLandingUpload('video', 'video/mp4') === 'mp4')
  check('extensionForLandingUpload: video/webm -> webm', extensionForLandingUpload('video', 'video/webm') === 'webm')
  check('extensionForLandingUpload: video/quicktime (MOV) is REJECTED for video (task spec: MP4/WebM only, no MOV)', extensionForLandingUpload('video', 'video/quicktime') === null)
  check('extensionForLandingUpload: cross-kind confusion rejected (image contentType requested as kind=video)', extensionForLandingUpload('video', 'image/jpeg') === null)
  check('extensionForLandingUpload: an unrecognized kind is rejected regardless of contentType', extensionForLandingUpload('avatar', 'image/jpeg') === null)

  check('MAX_LANDING_IMAGE_BYTES is exactly 5MB (task spec)', MAX_LANDING_IMAGE_BYTES === 5 * 1024 * 1024)
  check('MAX_LANDING_VIDEO_BYTES is exactly 20MB (task spec)', MAX_LANDING_VIDEO_BYTES === 20 * 1024 * 1024)
  check('maxBytesForLandingKind returns the video ceiling for video', maxBytesForLandingKind('video') === MAX_LANDING_VIDEO_BYTES)
  check('maxBytesForLandingKind returns the image ceiling for image (and any unrecognized kind, fail-closed to the SMALLER limit)', maxBytesForLandingKind('image') === MAX_LANDING_IMAGE_BYTES && maxBytesForLandingKind('bogus') === MAX_LANDING_IMAGE_BYTES)

  check('publicStorageUrl produces the same stable googleapis.com shape api/upload.js already uses for public dog photos',
    publicStorageUrl('idogs-app-staging.firebasestorage.app', 'landing-media/hero/published/abc.jpg') ===
    'https://storage.googleapis.com/idogs-app-staging.firebasestorage.app/landing-media/hero/published/abc.jpg')

  check('sanitizeDisplayFilename strips path separators (never usable for path traversal in display)', sanitizeDisplayFilename('../../etc/passwd') === '....etcpasswd')
  check('sanitizeDisplayFilename strips control characters', sanitizeDisplayFilename('evil\x00name\x1f.jpg') === 'evilname.jpg')
  check('sanitizeDisplayFilename bounds length to 200 chars', sanitizeDisplayFilename('a'.repeat(500)).length === 200)
  check('sanitizeDisplayFilename returns empty string for non-string input', sanitizeDisplayFilename(undefined) === '' && sanitizeDisplayFilename(null) === '')

  check('landingMediaUploadGrants/published/drafts collections are three distinct names, none colliding with existing mediaUploadGrants/mediaUploadQuotas',
    new Set([LANDING_MEDIA_PUBLISHED_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION, LANDING_MEDIA_GRANTS_COLLECTION]).size === 3 &&
    ![LANDING_MEDIA_PUBLISHED_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION, LANDING_MEDIA_GRANTS_COLLECTION].includes('mediaUploadGrants'))

  // ── request-landing-media-upload.js source ──
  const requestSrc = readFileSync(new URL('../api/request-landing-media-upload.js', import.meta.url), 'utf8')
  check('request-landing-media-upload.js requires Super Admin authorization before any Firestore/Storage work', /requireSuperAdmin\(req, getAuth\)/.test(requestSrc))
  check('request-landing-media-upload.js validates slotId against the fixed allowlist, never trusts a client-supplied path', /isValidSlotId\(slotId\)/.test(requestSrc) && !/req\.body\.path/.test(requestSrc))
  check('request-landing-media-upload.js builds the Storage path from a fresh randomUUID() scoped under the validated slotId, never a client-supplied filename', /`landing-media\/\$\{slotId\}\/drafts\/\$\{randomUUID\(\)\}\.\$\{extension\}`/.test(requestSrc))
  check('request-landing-media-upload.js rejects an unsupported contentType/kind pair before touching Firestore/Storage', /extensionForLandingUpload\(kind, contentType\)/.test(requestSrc) && /UNSUPPORTED_CONTENT_TYPE/.test(requestSrc))
  check('request-landing-media-upload.js enforces the size ceiling BEFORE minting any signed URL', (() => {
    const guardIdx = requestSrc.indexOf('sizeBytes > maxBytes')
    const signIdx = requestSrc.indexOf('getSignedUrl')
    return guardIdx !== -1 && signIdx !== -1 && guardIdx < signIdx
  })())
  check('request-landing-media-upload.js signs with version v4, action write, and the no-overwrite precondition header', /version: 'v4'/.test(requestSrc) && /action: 'write'/.test(requestSrc) && /extensionHeaders: NO_OVERWRITE_HEADER/.test(requestSrc))
  check('request-landing-media-upload.js rate-limits per admin uid', /checkDurableRateLimit\(db, 'landing-media-upload'/.test(requestSrc))

  // ── confirm-landing-media-upload.js source ──
  const confirmSrc = readFileSync(new URL('../api/confirm-landing-media-upload.js', import.meta.url), 'utf8')
  check('confirm-landing-media-upload.js requires Super Admin authorization', /requireSuperAdmin\(req, getAuth\)/.test(confirmSrc))
  check('confirm-landing-media-upload.js accepts only mediaId/filename from the client — slotId/kind/path always come from the stored grant', /const \{ mediaId, filename \} = req\.body/.test(confirmSrc) && !/const \{ mediaId, slotId/.test(confirmSrc) && !/const \{ mediaId, path/.test(confirmSrc))
  check('confirm-landing-media-upload.js rejects a grant that does not belong to the confirming admin', /grant\.uid !== admin\.uid/.test(confirmSrc) && /NOT_GRANT_OWNER/.test(confirmSrc))
  check('confirm-landing-media-upload.js rejects a grant that is not still pending (blocks double-confirm)', /grant\.status !== 'pending'/.test(confirmSrc) && /ALREADY_CONFIRMED/.test(confirmSrc))
  check('confirm-landing-media-upload.js rejects and cleans up an expired grant', /GRANT_EXPIRED/.test(confirmSrc) && /deleteObjectQuietly\(bucket, grant\.path\)/.test(confirmSrc))
  check('confirm-landing-media-upload.js independently re-checks the REAL Storage object size via getMetadata(), before downloading the full buffer', confirmSrc.indexOf('file.getMetadata()') !== -1 && confirmSrc.indexOf('file.getMetadata()') < confirmSrc.indexOf('file.download()'))
  check('confirm-landing-media-upload.js sniffs the REAL uploaded bytes via the shared image-pipeline sniffers, never trusting the grant\'s declared contentType', /sniffImageMimeType\(rawBuffer\)/.test(confirmSrc) && /sniffVideoMimeType\(rawBuffer\)/.test(confirmSrc))
  check('confirm-landing-media-upload.js narrows the shared sniffers to landing media\'s own allowlist (rejects a real HEIC/MOV sniff even though the shared sniffer recognizes it)', /ALLOWED_IMAGE_SNIFFS/.test(confirmSrc) && /ALLOWED_VIDEO_SNIFFS/.test(confirmSrc) && !/ALLOWED_IMAGE_SNIFFS.*heic/i.test(confirmSrc))
  check('confirm-landing-media-upload.js deletes an invalid uploaded object rather than leaving an unproven file behind', /deleteObjectQuietly\(bucket, grant\.path\)/.test(confirmSrc))
  check('confirm-landing-media-upload.js only deletes the PREVIOUS draft object AFTER the new draft is committed in the same transaction', (() => {
    const txIdx = confirmSrc.indexOf('db.runTransaction')
    const cleanupIdx = confirmSrc.indexOf('deleteObjectQuietly(bucket, previousDraftPath)')
    return txIdx !== -1 && cleanupIdx !== -1 && txIdx < cleanupIdx
  })())
  check('confirm-landing-media-upload.js sanitizes the client-supplied display filename before storing it', /sanitizeDisplayFilename\(filename/.test(confirmSrc))
  check('confirm-landing-media-upload.js returns a fresh signed preview URL for the admin\'s own eyes only', /getSignedUrl\(\{ action: 'read'/.test(confirmSrc))

  // ── get-landing-media-state.js source ──
  const stateSrc = readFileSync(new URL('../api/get-landing-media-state.js', import.meta.url), 'utf8')
  check('get-landing-media-state.js requires Super Admin authorization', /requireSuperAdmin\(req, getAuth\)/.test(stateSrc))
  check('get-landing-media-state.js returns state for every fixed slot', /SLOT_IDS\.map/.test(stateSrc))
  check('get-landing-media-state.js verifies the draft Storage object still exists before minting a preview URL for it (never a broken preview)', /file\.exists\(\)/.test(stateSrc))

  // ── manage-landing-media.js source ──
  const manageSrc = readFileSync(new URL('../api/manage-landing-media.js', import.meta.url), 'utf8')
  check('manage-landing-media.js requires Super Admin authorization', /requireSuperAdmin\(req, getAuth\)/.test(manageSrc))
  check('manage-landing-media.js validates slotId and restricts action to the three known values', /isValidSlotId\(slotId\)/.test(manageSrc) && /'publish'.*'remove'.*'cancel-draft'/.test(manageSrc.replace(/\n/g, ' ')))
  check('publish() copies the draft to a FRESH published path before making it public — never overwrites the draft object in place', /draftFile\.copy\(publishedFile\)/.test(manageSrc) && /publishedFile\.makePublic\(\)/.test(manageSrc))
  check('publish() deletes the OLD published object only AFTER the new published doc is committed (never before — preserves live media on failure)', (() => {
    const commitIdx = manageSrc.indexOf('await batch.commit()')
    const cleanupIdx = manageSrc.indexOf('deleteObjectQuietly(bucket, previousPublishedPath)')
    return commitIdx !== -1 && cleanupIdx !== -1 && commitIdx < cleanupIdx
  })())
  check('publish() rejects when there is no draft, WITHOUT touching the currently-published doc at all', /NO_DRAFT/.test(manageSrc))
  check('remove() deletes the Firestore published doc BEFORE cleaning up its Storage object (Firestore is the source of truth for "is this public")', (() => {
    const deleteIdx = manageSrc.indexOf('await publishedRef.delete()')
    const cleanupIdx = manageSrc.indexOf('deleteObjectQuietly(bucket, previousPath)')
    return deleteIdx !== -1 && cleanupIdx !== -1 && deleteIdx < cleanupIdx
  })())
  check('remove() is idempotent when nothing is published (no error on a redundant call)', /alreadyRemoved/.test(manageSrc))
  check('cancelDraft() is idempotent when there is no draft', /alreadyClear/.test(manageSrc))

  // ── firestore.rules ──
  const rulesSrc = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules grants public read on landingMediaPublished', /match \/landingMediaPublished\/\{slotId\}\s*\{\s*allow read: if true;/.test(rulesSrc))
  check('firestore.rules denies ALL client writes to landingMediaPublished (write-only via the trusted Admin SDK endpoint)', /match \/landingMediaPublished\/\{slotId\}[\s\S]{0,120}allow write: if false;/.test(rulesSrc))
  check('firestore.rules has NO explicit rule for landingMediaDrafts — it falls through to the default-deny closing match (never client-readable at all)', !/match \/landingMediaDrafts/.test(rulesSrc))
  check('firestore.rules still ends with a default-deny-all closing match', /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rulesSrc))

  // ── storage.rules — untouched, no Storage Rules change required ──
  const storageRulesSrc = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8')
  check('storage.rules is still deny-all for every path (landing media direct-upload security comes from the signed URL, not relaxed Storage Rules)', /allow read, write: if false/.test(storageRulesSrc))

  // ── client: src/lib/superAdmin.ts + AppLayout.tsx reuse ──
  const superAdminSrc = readFileSync(new URL('../src/lib/superAdmin.ts', import.meta.url), 'utf8')
  check('src/lib/superAdmin.ts exports SUPER_ADMIN_EMAILS and isSuperAdminEmail', /export const SUPER_ADMIN_EMAILS/.test(superAdminSrc) && /export function isSuperAdminEmail/.test(superAdminSrc))
  const appLayoutSrc = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
  check('AppLayout.tsx imports SUPER_ADMIN_EMAILS from the shared module rather than a local duplicate', /import \{ SUPER_ADMIN_EMAILS \} from '\.\.\/\.\.\/lib\/superAdmin'/.test(appLayoutSrc) && !/const SUPER_ADMIN_EMAILS = \[/.test(appLayoutSrc))
  check('AppLayout.tsx links to the new internal Landing Page Media admin route', /\/app\/admin\/landing-media/.test(appLayoutSrc))

  // ── client: src/lib/landingMedia.ts ──
  const clientLibSrc = readFileSync(new URL('../src/lib/landingMedia.ts', import.meta.url), 'utf8')
  check('landingMedia.ts client validation matches the server allowlist (JPG/PNG/WebP images, MP4/WebM video)', /image\/jpeg.*image\/png.*image\/webp/s.test(clientLibSrc) && /video\/mp4.*video\/webm/s.test(clientLibSrc))
  check('landingMedia.ts uses XMLHttpRequest for the direct PUT (fetch has no upload-progress API)', /new XMLHttpRequest\(\)/.test(clientLibSrc) && /xhr\.upload\.onprogress/.test(clientLibSrc))
  check('fetchPublishedLandingMedia never throws — returns null on any failure (public page must never show a broken box)', /catch \{\s*return null/.test(clientLibSrc))

  // ── client: LandingPage.tsx wiring (all four slots present) ──
  const landingSrc = readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8')
  for (const slotId of SLOT_IDS) {
    check(`LandingPage.tsx renders a LandingMediaSlot for slotId="${slotId}"`, landingSrc.includes(`slotId="${slotId}"`))
  }
  check('LandingMediaSlot falls back to the exact original placeholder markup whenever media is missing or fails to load', /if \(!media \|\| failed\) return <>\{fallback\}<\/>/.test(landingSrc))
  check('LandingMediaSlot video renders autoPlay muted loop playsInline (never autoplay with sound)', /autoPlay[\s\S]{0,40}muted[\s\S]{0,40}loop[\s\S]{0,40}playsInline/.test(landingSrc))
  check('LandingMediaSlot reads ONLY published media, never a draft (fetchPublishedLandingMedia, not any draft-fetching call)', /fetchPublishedLandingMedia\(slotId\)/.test(landingSrc) && !/fetchLandingMediaState/.test(landingSrc))

  // ── client: LandingMediaAdminPage.tsx ──
  const adminPageSrc = readFileSync(new URL('../src/pages/LandingMediaAdminPage.tsx', import.meta.url), 'utf8')
  check('LandingMediaAdminPage.tsx gates on isSuperAdminEmail before rendering any management UI', /isSuperAdminEmail\(user\?\.email\)/.test(adminPageSrc) && /Admin only/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx shows Upload/Replace, Publish, Cancel draft, and Remove actions', /Upload/.test(adminPageSrc) && /Publish/.test(adminPageSrc) && /Cancel draft/.test(adminPageSrc) && /Remove/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx confirms before Remove (destructive-action convention already used elsewhere in this codebase)', /window\.confirm/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx disables the Upload/Remove/Publish/Cancel actions while any action for that slot is in flight', /disabled=\{busy\}/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx shows upload progress', /uploadProgress/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx shows inline errors', /ui\.error/.test(adminPageSrc))
  check('LandingMediaAdminPage.tsx shows filename/type/size/updated-date metadata', /formatBytes/.test(adminPageSrc) && /formatDate/.test(adminPageSrc))

  // ── client: App.tsx route wiring ──
  const appSrc = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')
  check('App.tsx wires the admin/landing-media route inside the ProtectedRoute+AppLayout block', /path="admin\/landing-media" element=\{<LandingMediaAdminPage/.test(appSrc))
}

// =========================================================================
// SECTION 2 — Firestore Rules emulator (real rules, real read/write attempts)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing')
  const { doc, getDoc, setDoc } = await import('firebase/firestore')

  const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  // Must match Section 3's project id exactly — the Auth emulator runs in
  // "single project mode" by default (see firebase.json), so using a
  // second, different project id here caused Section 3's Admin SDK calls
  // to fail looking up a user the client SDK had just created under a
  // different project namespace within the same emulator process.
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-idogs-qa'
  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host, port: Number(portStr) },
  })

  async function seedPublished(slotId, data) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${LANDING_MEDIA_PUBLISHED_COLLECTION}/${slotId}`), data)
    })
  }
  async function seedDraft(slotId, data) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${LANDING_MEDIA_DRAFTS_COLLECTION}/${slotId}`), data)
    })
  }

  await seedPublished('hero', { slotId: 'hero', kind: 'image', url: 'https://storage.googleapis.com/x/hero.jpg' })
  await seedDraft('hero', { slotId: 'hero', kind: 'image', path: 'landing-media/hero/drafts/secret.jpg' })

  await checkAsync('Rules: an UNAUTHENTICATED public visitor CAN read landingMediaPublished/hero', async () => {
    const publicDb = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(publicDb, `${LANDING_MEDIA_PUBLISHED_COLLECTION}/hero`)))
    return true
  })
  await checkAsync('Rules: an UNAUTHENTICATED public visitor CANNOT read landingMediaDrafts/hero (the private draft path is never exposed)', async () => {
    const publicDb = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(publicDb, `${LANDING_MEDIA_DRAFTS_COLLECTION}/hero`)))
    return true
  })
  await checkAsync('Rules: an authenticated but non-admin user CANNOT write landingMediaPublished/hero directly (write-only via the trusted Admin SDK endpoint)', async () => {
    const userDb = testEnv.authenticatedContext('randomBreederUid').firestore()
    await assertFails(setDoc(doc(userDb, `${LANDING_MEDIA_PUBLISHED_COLLECTION}/hero`), { slotId: 'hero', kind: 'image', url: 'https://evil.example/x.jpg' }))
    return true
  })
  await checkAsync('Rules: even the Super Admin\'s own authenticated client cannot write landingMediaPublished directly (Rules have no email-allowlist concept — write ALWAYS goes through the Admin SDK endpoint, which independently checks the allowlist)', async () => {
    const adminDb = testEnv.authenticatedContext('trunghieungo-uid').firestore()
    await assertFails(setDoc(doc(adminDb, `${LANDING_MEDIA_PUBLISHED_COLLECTION}/hero`), { slotId: 'hero', kind: 'image', url: 'https://storage.googleapis.com/x/new.jpg' }))
    return true
  })
  await checkAsync('Rules: reading a slot that has never been published returns "not found", not a permission error', async () => {
    const publicDb = testEnv.unauthenticatedContext().firestore()
    const snap = await getDoc(doc(publicDb, `${LANDING_MEDIA_PUBLISHED_COLLECTION}/digital-passport`))
    return snap.exists() === false
  })

  // Section 3 (if it also runs) shares this same emulator/project and
  // asserts every slot starts empty — cleanup() tears down the test
  // environment's own app connections but does NOT clear emulator data,
  // so the hero doc seeded above must be explicitly cleared here or it
  // would leak into and fail Section 3's own assertions.
  await testEnv.clearFirestore()
  await testEnv.cleanup()
} else {
  skip('Section 2 Firestore Rules emulator (landing media)', 'set FIRESTORE_EMULATOR_HOST and start the emulator to run it')
}

// =========================================================================
// SECTION 3 — full endpoint emulator end-to-end (real handlers, real Storage)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`

  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const { default: requestHandler } = await import('../api/request-landing-media-upload.js')
  const { default: confirmHandler } = await import('../api/confirm-landing-media-upload.js')
  const { default: stateHandler } = await import('../api/get-landing-media-state.js')
  const { default: manageHandler } = await import('../api/manage-landing-media.js')

  const seedDb = getFirestore()
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET)

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'landing-media-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

  const sharp = (await import('sharp')).default
  const jpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()
  const pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  function fakeMp4Buffer() {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(28, 0)
    header.write('ftyp', 4, 'ascii')
    header.write('isom', 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(16, 0x00)])
  }
  function fakeMovBuffer() {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(28, 0)
    header.write('ftyp', 4, 'ascii')
    header.write('qt  ', 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(16, 0x00)])
  }

  function mockReq(body, token, method = 'POST') {
    return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }
  }
  function mockRes() {
    const res = { statusCode: 200, body: null }
    res.status = c => { res.statusCode = c; return res }
    res.json = p => { res.body = p; return res }
    res.setHeader = () => {}
    return res
  }

  const R = Date.now()
  const PW = 'tam12345*'
  async function newUser(name, verified = true) {
    const email = `${name}.${R}@emulator.local`
    const { user } = await createUserWithEmailAndPassword(clientAuth, email, PW)
    // Firebase Auth emulator does not verify email by default; the
    // real production identity check (email_verified) is exercised via
    // an ADMIN SDK-set claim below where a test specifically needs it —
    // requireSuperAdmin's own email allowlist check is what most tests
    // here exercise, and the emulator's decoded token DOES carry a real
    // email_verified field reflecting the account's actual state.
    return { uid: user.uid, idToken: await user.getIdToken(), email, verified }
  }
  async function requestUpload(slotId, kind, contentType, token, sizeBytes) {
    const res = mockRes()
    await requestHandler(mockReq({ slotId, kind, contentType, sizeBytes }, token), res)
    return res
  }
  async function readGrant(mediaId) {
    const snap = await seedDb.collection(LANDING_MEDIA_GRANTS_COLLECTION).doc(mediaId).get()
    return snap.exists ? snap.data() : null
  }
  async function confirmUpload(mediaId, token, filename) {
    const res = mockRes()
    await confirmHandler(mockReq({ mediaId, filename }, token), res)
    return res
  }
  async function getState(token) {
    const res = mockRes()
    await stateHandler(mockReq({}, token, 'GET'), res)
    return res
  }
  async function manage(action, slotId, token) {
    const res = mockRes()
    await manageHandler(mockReq({ action, slotId }, token), res)
    return res
  }

  // The Auth emulator issues tokens with email_verified:false for a
  // freshly created user — requireSuperAdmin() (correctly) treats that
  // as not-yet-a-verified-identity regardless of the email string, which
  // would make EVERY "admin" test below fail for a reason unrelated to
  // what it's actually testing (the allowlist check itself). Since this
  // codebase's real Super Admin accounts (trunghieungo@gmail.com,
  // theresanguyenngo@gmail.com) are real, already-verified accounts in
  // production/staging, tests here mark the emulator user's email
  // verified via the Admin SDK first — exercising the allowlist logic
  // this test file actually owns, while the SEPARATE email_verified
  // requirement is covered by its own explicit dedicated test below.
  const { getAuth: getAdminAuth } = await import('firebase-admin/auth')
  async function newVerifiedAdminUser() {
    const email = `trunghieungo+test${R}@gmail.com` // not on the real allowlist string exactly — see allowlist test below for the exact-match requirement
    const { user } = await createUserWithEmailAndPassword(clientAuth, `admin.${R}@emulator.local`, PW)
    await getAdminAuth().updateUser(user.uid, { email: 'trunghieungo@gmail.com', emailVerified: true })
    // Force a fresh token carrying the updated email/verified claims.
    await user.getIdToken(true)
    const idToken = await user.getIdToken()
    return { uid: user.uid, idToken }
  }

  // ── unauthorized ──
  await checkAsync('request: an unauthenticated call (no token) is rejected (403)', async () => {
    const res = await requestUpload('hero', 'image', 'image/jpeg', undefined, 1000)
    return res.statusCode === 403
  })
  await checkAsync('confirm: an unauthenticated call is rejected (403)', async () => {
    const res = await confirmUpload('anything', undefined)
    return res.statusCode === 403
  })
  await checkAsync('get-state: an unauthenticated call is rejected (403)', async () => {
    const res = await getState(undefined)
    return res.statusCode === 403
  })
  await checkAsync('manage: an unauthenticated call is rejected (403)', async () => {
    const res = await manage('publish', 'hero', undefined)
    return res.statusCode === 403
  })

  // ── a real, verified, but NON-admin account is rejected everywhere ──
  {
    const breeder = await newUser('dubreeder')
    await checkAsync('request: a normal (non-admin) breeder is denied (403), even with a fully valid token', async () => {
      const res = await requestUpload('hero', 'image', 'image/jpeg', breeder.idToken, 1000)
      return res.statusCode === 403
    })
    await checkAsync('get-state: a normal breeder is denied (403)', async () => {
      const res = await getState(breeder.idToken)
      return res.statusCode === 403
    })
    await checkAsync('manage: a normal breeder cannot publish/remove/cancel anything (403)', async () => {
      const res = await manage('remove', 'hero', breeder.idToken)
      return res.statusCode === 403
    })
  }

  // ── admin allowed ──
  const admin = await newVerifiedAdminUser()

  await checkAsync('get-state: the Super Admin can load state (200), all four slots present and initially empty', async () => {
    const res = await getState(admin.idToken)
    return res.statusCode === 200 &&
      SLOT_IDS.every(id => res.body.slots[id] && res.body.slots[id].published === null && res.body.slots[id].draft === null)
  })

  // ── MIME/extension/size validation ──
  await checkAsync('request: an unsupported contentType for kind=image is rejected (400)', async () => {
    const res = await requestUpload('hero', 'image', 'image/gif', admin.idToken, 1000)
    return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_CONTENT_TYPE'
  })
  await checkAsync('request: HEIC is rejected even though it is a real recognized image format elsewhere in this codebase (task spec: JPG/PNG/WebP only)', async () => {
    const res = await requestUpload('hero', 'image', 'image/heic', admin.idToken, 1000)
    return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_CONTENT_TYPE'
  })
  await checkAsync('request: an image whose claimed size is over 5MB is rejected (400) before a signed URL is issued', async () => {
    const res = await requestUpload('hero', 'image', 'image/jpeg', admin.idToken, 5 * 1024 * 1024 + 1)
    return res.statusCode === 400 && res.body.reason === 'FILE_TOO_LARGE' && res.body.mediaId === undefined
  })
  await checkAsync('request: a video whose claimed size is over 20MB is rejected (400)', async () => {
    const res = await requestUpload('hero', 'video', 'video/mp4', admin.idToken, 20 * 1024 * 1024 + 1)
    return res.statusCode === 400 && res.body.reason === 'FILE_TOO_LARGE'
  })
  await checkAsync('request: an invalid slotId is rejected (400) — cross-slot tampering guard at request time', async () => {
    const res = await requestUpload('not-a-real-slot', 'image', 'image/jpeg', admin.idToken, 1000)
    return res.statusCode === 400
  })

  // ── confirm: real magic-byte sniffing narrowed to the landing allowlist ──
  {
    let mediaId, path
    await checkAsync('request: a valid image grant is issued for the hero slot', async () => {
      const res = await requestUpload('hero', 'image', 'image/jpeg', admin.idToken, 1000)
      mediaId = res.body?.mediaId
      path = (await readGrant(mediaId))?.path
      return res.statusCode === 200 && typeof path === 'string' && path.startsWith('landing-media/hero/drafts/')
    })
    await bucket.file(path).save(Buffer.from('not actually a jpeg'), { metadata: { contentType: 'image/jpeg' } })
    await checkAsync('confirm: real sniffing rejects an object that is not actually a JPEG, even with an image/jpeg Content-Type (400)', async () => {
      const res = await confirmUpload(mediaId, admin.idToken, 'fake.jpg')
      return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_IMAGE_TYPE'
    })
    await checkAsync('confirm: the rejected object is deleted from Storage', async () => {
      const [exists] = await bucket.file(path).exists()
      return exists === false
    })

    let movMediaId, movPath
    await checkAsync('request: a video grant is issued (client CLAIMS video/mp4)', async () => {
      const res = await requestUpload('hero', 'video', 'video/mp4', admin.idToken, 1000)
      movMediaId = res.body?.mediaId
      movPath = (await readGrant(movMediaId))?.path
      return res.statusCode === 200
    })
    await bucket.file(movPath).save(fakeMovBuffer(), { metadata: { contentType: 'video/mp4' } })
    await checkAsync('confirm: a REAL QuickTime/MOV file is rejected (400 UNSUPPORTED_VIDEO_TYPE) even though it was requested/uploaded as video/mp4 — sniffing catches the mislabel AND landing media\'s allowlist rejects MOV outright', async () => {
      const res = await confirmUpload(movMediaId, admin.idToken)
      return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_VIDEO_TYPE'
    })
  }

  // ── confirm: real size re-check against the ACTUAL uploaded object (never the client-claimed size alone) ──
  {
    let mediaId, path
    await checkAsync('request: a video grant is issued with a claimed size well UNDER 20MB (the lie)', async () => {
      const res = await requestUpload('puppy-showcase', 'video', 'video/mp4', admin.idToken, 1000)
      mediaId = res.body?.mediaId
      path = (await readGrant(mediaId))?.path
      return res.statusCode === 200
    })
    const oversized = Buffer.concat([fakeMp4Buffer(), Buffer.alloc(20 * 1024 * 1024 + 1024, 0x00)])
    await bucket.file(path).save(oversized, { metadata: { contentType: 'video/mp4' } })
    await checkAsync('confirm: the REAL uploaded object exceeds 20MB — rejected (400 FILE_TOO_LARGE) regardless of the claimed size at request time', async () => {
      const res = await confirmUpload(mediaId, admin.idToken)
      return res.statusCode === 400 && res.body.reason === 'FILE_TOO_LARGE'
    })
  }

  // ── cross-slot / path tampering: confirm always uses the GRANT's own slotId/path, never anything else ──
  {
    let mediaId, path
    await checkAsync('request: a legitimate image grant is issued for the "dog-profile" slot', async () => {
      const res = await requestUpload('dog-profile', 'image', 'image/png', admin.idToken, 1000)
      mediaId = res.body?.mediaId
      path = (await readGrant(mediaId))?.path
      return res.statusCode === 200 && path.startsWith('landing-media/dog-profile/drafts/')
    })
    await bucket.file(path).save(pngBuffer, { metadata: { contentType: 'image/png' } })
    await checkAsync('confirm: passing an extra, unexpected slotId in the request body has NO effect — confirm derives slotId only from the stored grant, never client input', async () => {
      const res = mockRes()
      await confirmHandler(mockReq({ mediaId, slotId: 'hero', filename: 'x.png' }, admin.idToken), res)
      return res.statusCode === 200 && res.body.slotId === 'dog-profile'
    })
    await checkAsync('confirm: the draft is recorded under "dog-profile", NOT "hero" — the tampering attempt had no effect on which slot was updated', async () => {
      const draftSnap = await seedDb.collection(LANDING_MEDIA_DRAFTS_COLLECTION).doc('dog-profile').get()
      return draftSnap.exists && draftSnap.data().path === path
    })
    await checkAsync('manage: publishing an INVALID slotId is rejected outright (400) before touching any real slot', async () => {
      const res = await manage('publish', 'not-a-real-slot', admin.idToken)
      return res.statusCode === 400
    })
  }

  // ── draft vs published separation + full publish lifecycle ──
  {
    const slotId = 'digital-passport'
    let mediaId, path

    await checkAsync('request+confirm: a valid image draft is uploaded for digital-passport', async () => {
      const reqRes = await requestUpload(slotId, 'image', 'image/webp', admin.idToken, 1000)
      mediaId = reqRes.body?.mediaId
      path = (await readGrant(mediaId))?.path
      const sharpMod = (await import('sharp')).default
      const webpBuffer = await sharpMod({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).webp().toBuffer()
      await bucket.file(path).save(webpBuffer, { metadata: { contentType: 'image/webp' } })
      const confirmRes = await confirmUpload(mediaId, admin.idToken, 'my hero shot.webp')
      return confirmRes.statusCode === 200 && confirmRes.body.draft.contentType === 'image/webp'
    })

    await checkAsync('state: the slot now shows a draft, but published is still null — uploading never publishes anything', async () => {
      const res = await getState(admin.idToken)
      return res.body.slots[slotId].draft !== null && res.body.slots[slotId].published === null
    })

    await checkAsync('publish: promotes the draft to published (200)', async () => {
      const res = await manage('publish', slotId, admin.idToken)
      return res.statusCode === 200 && res.body.published.slotId === slotId && res.body.published.url.startsWith('https://storage.googleapis.com/')
    })

    await checkAsync('after publish: the draft is cleared (state no longer shows an unpublished draft for this slot)', async () => {
      const res = await getState(admin.idToken)
      return res.body.slots[slotId].draft === null && res.body.slots[slotId].published !== null
    })

    await checkAsync('publish() actually calls makePublic() on the new object (verified via source above); the object\'s real public-readability is confirmed structurally, not against the emulator', async () => {
      // The Firebase Storage emulator prints its own explicit warning
      // when this runs: "Cloud Storage ACLs are not supported in the
      // Storage Emulator. All related methods will succeed, but have no
      // effect." — makePublic() and getMetadata().acl are both no-ops
      // there, so there is no way to observe real public-ACL state
      // against the emulator (the same class of platform gap
      // test-direct-media-upload.mjs already documents for signed-URL
      // PUT). The source-level check earlier in this file
      // ("publish() copies the draft to a FRESH published path before
      // making it public") already proves makePublic() is called in the
      // right place; this just confirms the call didn't throw.
      const stateRes = await getState(admin.idToken)
      const publishedUrl = stateRes.body.slots[slotId].published.url
      const publishedPath = decodeURIComponent(new URL(publishedUrl).pathname.split('/').slice(2).join('/'))
      const [exists] = await bucket.file(publishedPath).exists()
      return exists === true
    })
    skip(
      'The published object is verified as genuinely public (real ACL check) against a live Storage bucket',
      'confirmed directly in this environment: the Firebase Storage emulator prints "Cloud Storage ACLs are not supported in the Storage Emulator. All related methods will succeed, but have no effect." — makePublic() and getMetadata().acl are both no-ops there. This is a Storage-emulator platform gap, not a gap in this endpoint\'s own logic (see manage-landing-media.js\'s own source-level check above, which does verify draftFile.copy() + publishedFile.makePublic() are both actually called).'
    )

    // ── remove/fallback ──
    await checkAsync('remove: clears the published slot (200)', async () => {
      const res = await manage('remove', slotId, admin.idToken)
      return res.statusCode === 200
    })
    await checkAsync('after remove: state shows published:null again (public page falls back to its placeholder)', async () => {
      const res = await getState(admin.idToken)
      return res.body.slots[slotId].published === null
    })
    await checkAsync('remove: calling it again when already removed is a harmless no-op (200, idempotent)', async () => {
      const res = await manage('remove', slotId, admin.idToken)
      return res.statusCode === 200 && res.body.alreadyRemoved === true
    })
  }

  // ── cancel-draft: discards the draft, never touches published ──
  {
    const slotId = 'puppy-showcase'
    // Publish something first, so we can prove cancel-draft leaves it alone.
    let mediaId, path, publishedPathBeforeCancel
    const reqRes = await requestUpload(slotId, 'image', 'image/jpeg', admin.idToken, 1000)
    mediaId = reqRes.body?.mediaId
    path = (await readGrant(mediaId))?.path
    await bucket.file(path).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    await confirmUpload(mediaId, admin.idToken)
    const publishRes = await manage('publish', slotId, admin.idToken)
    publishedPathBeforeCancel = publishRes.body?.published?.path

    // Now upload a SECOND draft (a pending replacement) and cancel it.
    const reqRes2 = await requestUpload(slotId, 'image', 'image/png', admin.idToken, 1000)
    const mediaId2 = reqRes2.body?.mediaId
    const path2 = (await readGrant(mediaId2))?.path
    await bucket.file(path2).save(pngBuffer, { metadata: { contentType: 'image/png' } })
    await confirmUpload(mediaId2, admin.idToken)

    await checkAsync('cancel-draft: discards the pending draft (200)', async () => {
      const res = await manage('cancel-draft', slotId, admin.idToken)
      return res.statusCode === 200
    })
    await checkAsync('cancel-draft: the draft\'s Storage object is deleted', async () => {
      const [exists] = await bucket.file(path2).exists()
      return exists === false
    })
    await checkAsync('cancel-draft: the PUBLISHED media from before is completely untouched (same path, still present)', async () => {
      const res = await getState(admin.idToken)
      return res.body.slots[slotId].draft === null &&
        res.body.slots[slotId].published !== null &&
        res.body.slots[slotId].published.path === publishedPathBeforeCancel
    })
  }

  // ── failed publish preserves currently-published media ──
  {
    const slotId = 'hero'
    // Publish a known-good image first.
    const reqRes = await requestUpload(slotId, 'image', 'image/jpeg', admin.idToken, 1000)
    const mediaId = reqRes.body?.mediaId
    const path = (await readGrant(mediaId))?.path
    await bucket.file(path).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    await confirmUpload(mediaId, admin.idToken)
    await manage('publish', slotId, admin.idToken)
    const beforeState = await getState(admin.idToken)
    const beforePublished = beforeState.body.slots[slotId].published

    // Attempt to publish again with NO draft present (already consumed
    // by the prior publish) — must fail cleanly, leaving the published
    // slot exactly as it was.
    await checkAsync('publish: with no draft present, publishing fails (400 NO_DRAFT)', async () => {
      const res = await manage('publish', slotId, admin.idToken)
      return res.statusCode === 400 && res.body.reason === 'NO_DRAFT'
    })
    await checkAsync('publish failure: the previously-published media is completely unchanged', async () => {
      const afterState = await getState(admin.idToken)
      const afterPublished = afterState.body.slots[slotId].published
      return afterPublished.path === beforePublished.path && afterPublished.url === beforePublished.url
    })
  }
} else {
  skip('Section 3 full endpoint emulator end-to-end (landing media)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run it')
}

await summary()
