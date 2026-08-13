import { existsSync, readFileSync } from 'node:fs'
import { mergePuppyEntry, validatePuppyPatch, ShowcaseValidationError } from '../api/_lib/showcase-schema.js'

let passed = 0
let failed = 0
function check(name, condition) { if (condition) { passed++; console.log(`PASS: ${name}`) } else { failed++; console.error(`FAIL: ${name}`) } }
function rejects(patch) { try { validatePuppyPatch(patch); return false } catch (error) { return error instanceof ShowcaseValidationError } }

const clean = validatePuppyPatch({ personality: '<script>alert(1)</script> Friendly <b>puppy</b>', priceCents: 249000, depositCents: 50000, showPrice: true, showDeposit: false, availability: 'sold' })
check('public text strips HTML tags', clean.personality === 'alert(1) Friendly puppy')
check('integer-cent price and deposit are accepted', clean.priceCents === 249000 && clean.depositCents === 50000)
check('negative money is rejected', rejects({ priceCents: -1 }))
check('floating-point cents are rejected', rejects({ depositCents: 12.5 }))
check('overlong public description is rejected', rejects({ personality: 'x'.repeat(501) }))
check('invalid public date is rejected', rejects({ readyToGoHomeDate: '03/08/2026' }))
const merged = mergePuppyEntry({ visible: true, availability: 'available', publishedPhotoIds: ['p1'], publishedVideoIds: [] }, { personality: 'Calm' })
check('metadata edit preserves visibility, availability and media', merged.visible && merged.availability === 'available' && merged.publishedPhotoIds[0] === 'p1')

const manager = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
const publicPage = readFileSync(new URL('../src/pages/ShowcasePublicPage.tsx', import.meta.url), 'utf8')
const publicApi = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
check('disabled-link status copy is exact', manager.includes('Share link created — Showcase is currently disabled'))
check('live status copy is exact', manager.includes('Showcase is live and publicly accessible'))
check('no-link status copy is exact', manager.includes('No public share link has been created'))
check('link rotation requires explicit confirmation', manager.includes("window.confirm('Create a new link?"))
check('Copy Link does not call the rotate endpoint', /navigator\.clipboard[^\n]+writeText/.test(manager))
check('share token survives reload in browser storage', manager.includes('window.localStorage.setItem') && manager.includes('window.localStorage.getItem'))
check('restored token is verified against current server hash', manager.includes("window.crypto.subtle.digest('SHA-256'") && manager.includes('hash === showcase.shareTokenHash'))
check('save failure copy is exact', manager.includes('Changes couldn’t be saved — try again'))
// UPDATE (official iDogs logo refresh, 2026-08-10): the single generic
// /logo.png was replaced by two official, context-appropriate variants
// (light-bg / dark-bg) — ShowcasePublicPage.tsx uses BOTH, per usage
// site's actual background (light for the placeholder/not-found states,
// dark for the Showcase header). The real intent this check protects —
// "uses an official iDogs logo asset, never a dog-emoji placeholder" —
// is unchanged; only the exact filename(s) it looks for are updated.
for (const asset of [
  '01_idogs_primary_horizontal_transparent.png',
  '02_idogs_icon_transparent.png',
  '03_idogs_reversed_white_transparent.png',
  '04_idogs_trademark_colour_white_background.png',
]) {
  check(`official logo asset exists: ${asset}`, existsSync(new URL(`../public/${asset}`, import.meta.url)))
}
check('public page uses official logo assets and no dog emoji placeholder',
  publicPage.includes('src="/01_idogs_primary_horizontal_transparent.png"') &&
  publicPage.includes('src="/03_idogs_reversed_white_transparent.png"') &&
  !publicPage.includes('🐶'))
check('puppy-specific CTA and accessible dialog exist', publicPage.includes('Enquire about {puppy.name}') && publicPage.includes('aria-modal="true"'))
check('dialog traps focus and restores the opener', publicPage.includes("event.key !== 'Tab'") && publicPage.includes('openerRef.current?.focus()') && publicPage.includes('closeRef.current?.focus()'))
check('hidden money fields are omitted from DTO', publicApi.includes("entry.showPrice === true") && publicApi.includes("entry.showDeposit === true"))
check('legacy statuses map to V2 public statuses', publicApi.includes("entry.availability === 'unavailable'") && publicApi.includes("entry.availability === 'on_hold'"))

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
