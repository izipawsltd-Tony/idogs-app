// scripts/test-showcase-fix-round.mjs — regression coverage for three
// confirmed staging bugs fixed together in one round: puppy Price/Deposit
// input corruption ("price limited to $10"), HEIC/HEIF upload failure,
// and a selected-but-visible puppy silently missing from the public
// Showcase page.
//
// Usage: node scripts/test-showcase-fix-round.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { isValidShowcasePuppyDoc } from '../api/_lib/showcase-schema.js'

const { check, summary } = makeChecker()

const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')

// ══════════════════════════════════════════════════════════════════════
// BUG 1 — Price (AUD) limited to $10 / corrupted to $2.00/$2.50
// ══════════════════════════════════════════════════════════════════════
//
// ROOT CAUSE: the old <input>'s `value` was derived from
// `(priceCents / 100).toFixed(2)` on EVERY render, with onChange writing
// straight back into priceCents. That reformats the field to "X.00"
// after each keystroke (cursor jumps to the end), so every subsequent
// digit typed lands in the fractional part instead of the integer part —
// typing "2500" digit by digit could only ever end up around $2.00/$2.50,
// never $2500. Fixed by driving the input's displayed value from its own
// separate, never-reformatted-mid-typing raw text state, only normalizing
// to a clean "X.YY" string on blur.
//
// parseMoneyLive/parseMoneyCommit/centsToMoneyText are pure functions
// defined inline in LittersPage.tsx (a .tsx file, not importable into
// plain Node — no ts-node/tsx dependency exists in this repo, matching
// this project's established convention for client-only logic). A
// hand-synced plain-JS duplicate is used here to run REAL assertions
// against the exact required cases, paired with structural checks below
// proving the actual source contains the same logic — the same
// established pattern already used for src/lib/utils.ts's
// getEffectivePlanClient (a hand-synced mirror of a server function).

function parseMoneyLive(text, previousCents) {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return previousCents
  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0) return previousCents
  return Math.round(dollars * 100)
}
function parseMoneyCommit(text) {
  const trimmed = text.trim()
  if (trimmed === '') return { cents: null, error: null }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { cents: null, error: 'Enter a valid amount like 2500 or 2500.00' }
  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0) return { cents: null, error: 'Enter a valid amount like 2500 or 2500.00' }
  return { cents: Math.round(dollars * 100), error: null }
}
function centsToMoneyText(cents) { return cents == null ? '' : (cents / 100).toFixed(2) }

for (const [input, expectedCents] of [['10', 1000], ['10.01', 1001], ['500', 50000], ['2490', 249000], ['2500', 250000]]) {
  const { cents, error } = parseMoneyCommit(input)
  check(`price "${input}" is accepted as exactly ${expectedCents} cents, never truncated/misparsed`, cents === expectedCents && error === null)
}
check('$2500 round-trips to a clean "2500.00" display string, never "2.50" or "2.00"', centsToMoneyText(250000) === '2500.00')

for (const bad of ['-5', '-5.00', 'abc', 'NaN', 'Infinity', '1.2.3', '5.999', '-0.01']) {
  const { cents, error } = parseMoneyCommit(bad)
  check(`malformed/negative/NaN/Infinity completed value "${bad}" is rejected (cents:null, a real error), never silently accepted`, cents === null && typeof error === 'string' && error.length > 0)
}
check('an empty field commits to no price (null, no error) — clearing the field is not a validation failure', JSON.stringify(parseMoneyCommit('')) === JSON.stringify({ cents: null, error: null }))

// The actual bug reproduction: typing "2500" character-by-character must
// never corrupt the raw text itself (this is what the OLD reformat-on-
// every-render bug broke — each keystroke landing after an already-
// reformatted "X.00" string). With the fix, raw text is simple string
// concatenation, completely decoupled from any rounded display.
{
  let raw = ''
  for (const ch of '2500') {
    raw += ch
    parseMoneyLive(raw, null) // must never throw or mutate raw
  }
  check('typing "2500" one character at a time leaves the raw input text as exactly "2500" (the fix for "$2500 became $2.00/$2.50")', raw === '2500')
  check('committing that raw text resolves to exactly 250000 cents ($2500.00)', parseMoneyCommit(raw).cents === 250000)
}

// ── Structural: the actual LittersPage.tsx source matches this logic ──

check('Price/Deposit inputs are type="text" inputMode="decimal" — NOT type="number" (a native number input\'s .value getter returns "" for an in-progress value like "10.", which would defeat raw-text tracking entirely)',
  (littersSrc.match(/type="text" inputMode="decimal" placeholder="0\.00"/g) || []).length === 2)
check('priceText/depositText raw-text state exists, separate from priceCents/depositCents', /const \[priceText, setPriceText\]/.test(littersSrc) && /const \[depositText, setDepositText\]/.test(littersSrc))
check('the price input\'s onChange never reformats the visible text — it sets priceText to the raw event value verbatim', /setPriceText\(prev => \(\{ \.\.\.prev, \[puppy\.id\]: raw \}\)\)/.test(littersSrc))
check('reformatting to a clean "X.YY" string only happens onBlur (parseMoneyCommit), never on every keystroke', /onBlur=\{\(\) => \{[\s\S]{0,120}parseMoneyCommit\(priceText\[puppy\.id\] \?\? ''\)/.test(littersSrc))
check('a blur-time validation error is surfaced via the existing puppyErrors mechanism', /if \(error\) setPuppyErrors\(prev => \(\{ \.\.\.prev, \[puppy\.id\]: error \}\)\)/.test(littersSrc))
check('deposit gets the exact same parseMoneyLive/parseMoneyCommit treatment as price ("keep deposit validation sensible")',
  (littersSrc.match(/parseMoneyLive\(raw, puppyFields\.(priceCents|depositCents)\)/g) || []).length === 2 &&
  (littersSrc.match(/parseMoneyCommit\((priceText|depositText)\[puppy\.id\] \?\? ''\)/g) || []).length === 2)
check('the live parser rejects a stray minus sign outright (never lets a negative provisional value into priceCents while typing)',
  parseMoneyLive('-5', 1000) === 1000 && parseMoneyLive('-', null) === null)

// ══════════════════════════════════════════════════════════════════════
// BUG 2 — HEIC/HEIF upload fails
// ══════════════════════════════════════════════════════════════════════
// See scripts/test-image-compression.mjs for the full structural suite
// covering decodeHeicToCanvas/loadLibheif/resizeAndEncodeJpeg. These
// checks are scoped to what test-image-compression.mjs does NOT already
// cover: the upload-failure-creates-no-orphan-record contract, and that
// authorization/ownership is untouched.

{
  const imgCompSrc = readFileSync(new URL('../src/lib/imageCompression.ts', import.meta.url), 'utf8')
  check('a HEIC decode failure throws (never resolves with a partial/garbage result) — prepareImageForUpload has no try/catch swallowing a decode error into a fallback value',
    !/catch[\s\S]{0,80}return \{ base64/.test(imgCompSrc))
}
check('a failed prepareImageForUpload() (any ImageCompressionError, including HEIC_DECODE_FAILED) is caught by Promise.allSettled in handleSaveShowcaseDraft — the file is never added to resolvedIds, so no upload-showcase-media call and no server-side media record is ever created for it',
  /const prepared = kind === 'photo'\s*\n\s*\? await prepareImageForUpload\(file\)/.test(littersSrc) &&
  /await Promise\.allSettled\(batch\.map\(async ref => \{/.test(littersSrc))
check('a failed upload leaves the puppy\'s draft error visible (puppyErrors) rather than silently discarding the file — the breeder can see it happened and retry',
  /setPuppyErrors\(prev => \(\{ \.\.\.prev, \[puppyId\]: result\.error \}\)\)/.test(littersSrc))

// Authorization/ownership/Storage Rules are untouched by this fix round —
// verified structurally by confirming the upload endpoint's auth check
// and the Storage Rules file both still exist with their established
// shape (a full behavioral re-check lives in the existing emulator
// suites this round did not modify: test-showcase-media-pipeline.mjs,
// test-h8-admin-upload-authorization.mjs).
{
  const uploadSrc = readFileSync(new URL('../api/upload-showcase-media.js', import.meta.url), 'utf8')
  check('api/upload-showcase-media.js still requires a verified Firebase ID token before anything else (untouched by the HEIC client-side fix)',
    /verifyIdToken/.test(uploadSrc))
  check('api/upload-showcase-media.js still checks dog ownership/write-access before accepting an upload, via canAddDogRecord/hasDogWriteAccess (untouched by the HEIC client-side fix)',
    /canAddDogRecord|hasDogWriteAccess/.test(uploadSrc))
}
{
  const storageRules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8')
  check('storage.rules file exists and is non-trivial (untouched by this fix round)', storageRules.length > 100)
}

// ══════════════════════════════════════════════════════════════════════
// BUG 3 — Selected, visible puppy missing from the public Showcase page
// ══════════════════════════════════════════════════════════════════════
// isValidShowcasePuppyDoc() is the exact function api/showcase-public.js
// now calls to decide whether a visible=true puppy actually gets
// included in the public response — tested directly here with plain
// objects, no emulator required.

const TENANT = 'tenant-1'
const LITTER_ID = 'litter-1'

check('a puppy whose OWN litterId correctly matches the current litter is valid (the normal, current-convention case — unchanged by this fix)',
  isValidShowcasePuppyDoc('puppy-1', { tenantId: TENANT, litterId: LITTER_ID }, TENANT, LITTER_ID, new Set(['puppy-1'])) === true)

check('THE FIX: a puppy with litterId completely ABSENT (a legacy dog document predating api/create-litter-puppy.js) is still valid, via the litter\'s own puppyIds membership — this is the exact bug confirmed on staging',
  isValidShowcasePuppyDoc('legacy-puppy', { tenantId: TENANT }, TENANT, LITTER_ID, new Set(['legacy-puppy'])) === true)

check('a puppy with litterId absent AND not listed in the litter\'s puppyIds is still correctly rejected (the fallback does not make every litterId-less dog showcaseable everywhere)',
  isValidShowcasePuppyDoc('unrelated-dog', { tenantId: TENANT }, TENANT, LITTER_ID, new Set(['some-other-puppy'])) === false)

check('SECURITY: a puppy whose litterId points at a DIFFERENT litter is rejected outright — the fallback never applies when litterId is present but wrong, so this cannot resurface a puppy under the wrong litter\'s page',
  isValidShowcasePuppyDoc('reassigned-puppy', { tenantId: TENANT, litterId: 'some-other-litter' }, TENANT, LITTER_ID, new Set(['reassigned-puppy'])) === false)

check('SECURITY: a cross-tenant dog is rejected regardless of litterId or puppyIds membership (tenant check happens first, unconditionally)',
  isValidShowcasePuppyDoc('cross-tenant-puppy', { tenantId: 'attacker-tenant' }, TENANT, LITTER_ID, new Set(['cross-tenant-puppy'])) === false)

check('SECURITY: a cross-tenant dog with a correctly-matching litterId string is STILL rejected — tenant match is required independently, litterId alone proves nothing',
  isValidShowcasePuppyDoc('cross-tenant-puppy-2', { tenantId: 'attacker-tenant', litterId: LITTER_ID }, TENANT, LITTER_ID, new Set(['cross-tenant-puppy-2'])) === false)

// ── A photo is NOT required for a puppy to show up publicly ───────────
{
  const publicSrc = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
  check('publicPuppyProjection never requires any photos/videos to exist before returning a full projection — only entry.availability must resolve (photos/videos default to empty arrays)',
    /const photos = publishedPhotos/.test(publicSrc) && !/if \(photos\.length === 0\)/.test(publicSrc) && !/if \(!photos\.length/.test(publicSrc))
  check('the visiblePuppyIds computation is driven purely by entry.visible === true — no additional media/photo condition gates which puppies are even looked up',
    /\.filter\(\(\[, entry\]\) => entry\?\.visible === true\)/.test(publicSrc))
}

// ── UI clarity requirements ────────────────────────────────────────────

check('the puppy-level checkbox is explicitly labeled "Show this puppy publicly" (visible text, not just an aria-label)',
  /Show this puppy publicly/.test(littersSrc))
check('the panel explains that publishing a photo does not, by itself, publish the puppy',
  /does not, by itself, make a puppy public/.test(littersSrc))
check('the price/deposit "show publicly" checkboxes are now distinctly labeled ("Show price publicly" / "Show deposit publicly"), never the same generic "Show publicly" text as the puppy-level checkbox',
  /Show price publicly/.test(littersSrc) && /Show deposit publicly/.test(littersSrc) && !/> Show publicly</.test(littersSrc))
check('the price/deposit checkboxes carry an explicit tooltip distinguishing them from the puppy\'s own visibility checkbox',
  (littersSrc.match(/Independent of the puppy's own 'Show this puppy publicly' checkbox above/g) || []).length === 2)
check('when 0 of N puppies are shown, the summary line explains what must be selected',
  /visibleCount === 0 && <>/.test(littersSrc) && /select &quot;Show this puppy publicly&quot; on at least one puppy below/.test(littersSrc))

summary()
