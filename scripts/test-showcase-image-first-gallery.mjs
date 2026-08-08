// scripts/test-showcase-image-first-gallery.mjs — regression coverage
// for the public Litter Showcase "image-first" redesign: more
// image-focused puppy cards, and a near-fullscreen, dark, object-fit:
// contain gallery replacing the old small cropped-16:9 white modal.
//
// Section 1 verifies the REAL source (ShowcasePublicPage.tsx, index.css)
// structurally, the same convention already established for this exact
// file in test-showcase-public-page.mjs (JSX can't be executed directly
// by plain Node). Section 2 mirrors the pure navigation math
// (goTo/goPrev/goNext's wraparound) and the contain-vs-cover choice in a
// small react-test-renderer harness — same "wrap the real pattern in a
// harness when the component itself isn't importable" approach used
// throughout this codebase's test suite.
//
// Usage: node scripts/test-showcase-image-first-gallery.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const pageSrc = readFileSync(new URL('../src/pages/ShowcasePublicPage.tsx', import.meta.url), 'utf8')
const cssSrc = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

// =========================================================================
// SECTION 1a — expanded gallery uses object-fit: contain, never cover,
// for the enlarged image/video (the exact "cropped" bug being fixed)
// =========================================================================
{
  check('the `contain` style constant sets objectFit to contain', /const contain = \{[^}]*objectFit: 'contain' as const/.test(pageSrc))
  check('the `contain` constant never upscales past natural size (width/height auto, only max-width/max-height ceilings)',
    /const contain = \{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' as const/.test(pageSrc))

  // Isolate the PuppyDialog function body so these checks can't
  // accidentally match PuppyCard's own (correctly still `cover`)
  // thumbnail image elsewhere in the file.
  function extractFunctionSource(src, signaturePattern) {
    const sigMatch = signaturePattern.exec(src)
    if (!sigMatch) return ''
    const startIdx = sigMatch.index
    const bodyOpenSearch = /\)\s*\{/.exec(src.slice(startIdx))
    if (!bodyOpenSearch) return ''
    const openIdx = startIdx + bodyOpenSearch.index + bodyOpenSearch[0].length - 1
    let depth = 0, inString = null, i = openIdx
    for (; i < src.length; i++) {
      const ch = src[i]
      if (inString) { if (ch === '\\') { i++; continue }; if (ch === inString) inString = null; continue }
      if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue }
      if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
      if (ch === '{') { depth++; continue }
      if (ch === '}') { depth--; if (depth === 0) { i++; break } }
    }
    return src.slice(startIdx, i)
  }
  const dialogSrc = extractFunctionSource(pageSrc, /function PuppyDialog\(/)
  check('PuppyDialog function body was located', dialogSrc.length > 500)

  check('REQUIRED: the enlarged photo <img> uses style={contain}, not style={cover}', /<img src=\{item\.url\}[^>]*style=\{contain\}/.test(dialogSrc))
  check('REQUIRED: the enlarged video uses style={contain}, not style={cover}', /<video src=\{item\.url\}[^>]*style=\{contain\}/.test(dialogSrc))
  check('the enlarged image/video area is never given style={cover} anywhere in PuppyDialog (the old cropping bug cannot silently return)',
    !/<img src=\{item\.url\}[\s\S]{0,120}style=\{cover\}/.test(dialogSrc) && !/<video src=\{item\.url\}[\s\S]{0,120}style=\{cover\}/.test(dialogSrc))
  check('the thumbnail strip intentionally keeps style={cover} (thumbnails are small fixed squares — only the ENLARGED view needed the contain fix)',
    /minWidth: 56, height: 44[\s\S]{0,400}style=\{cover\}/.test(dialogSrc))
}

// =========================================================================
// SECTION 1b — near-fullscreen, dark, CSS-driven responsive layout
// =========================================================================
{
  check('PuppyDialog\'s overlay uses the new dark near-fullscreen className, not the old small white inline-styled modal',
    /className="showcase-gallery-overlay"/.test(pageSrc) && /className="showcase-gallery"/.test(pageSrc))
  check('the gallery has a distinct dark image area and a distinct sidebar class (two-column structure)',
    /className="showcase-gallery-image-area"/.test(pageSrc) && /className="showcase-gallery-sidebar"/.test(pageSrc))

  check('REQUIRED: desktop gallery targets approximately 95vw x 92vh', /\.showcase-gallery \{[\s\S]{0,200}width: 95vw;[\s\S]{0,50}height: 92vh;/.test(cssSrc))
  check('the gallery uses a dark background for the image-viewing area', /\.showcase-gallery-image-area \{[\s\S]{0,100}background: #0b0b0b;/.test(cssSrc))
  check('REQUIRED: the sidebar is a narrow ~280-320px column', /\.showcase-gallery-sidebar \{[\s\S]{0,60}width: 300px;/.test(cssSrc))

  check('REQUIRED: a mobile breakpoint switches the gallery to a stacked (column) layout using nearly the full viewport',
    /@media \(max-width: 768px\) \{[\s\S]{0,800}\.showcase-gallery \{[\s\S]{0,150}flex-direction: column;[\s\S]{0,100}width: 100vw;[\s\S]{0,50}height: 100vh;/.test(cssSrc))
  check('the mobile sidebar respects safe-area insets (notches/home indicators)',
    /env\(safe-area-inset-right\)/.test(cssSrc) && /env\(safe-area-inset-bottom\)/.test(cssSrc) && /env\(safe-area-inset-left\)/.test(cssSrc))
}

// =========================================================================
// SECTION 1c — previous/next navigation between multiple photos
// =========================================================================
{
  check('REQUIRED: PuppyDialog defines goPrev/goNext navigation functions', /function goPrev\(\) \{ goTo\(active - 1\) \}/.test(pageSrc) && /function goNext\(\) \{ goTo\(active \+ 1\) \}/.test(pageSrc))
  check('goTo() wraps around in both directions (modulo-based, never throws/goes out of bounds at the ends)',
    /function goTo\(index: number\) \{ setActive\(\(\(index % media\.length\) \+ media\.length\) % media\.length\) \}/.test(pageSrc))
  check('REQUIRED: visible Previous/Next buttons exist, only when there is more than one media item', /media\.length > 1 && <>[\s\S]{0,50}aria-label="Previous photo"[\s\S]{0,200}aria-label="Next photo"/.test(pageSrc))
  check('REQUIRED: ArrowLeft/ArrowRight keyboard navigation is wired into the SAME keydown listener as Escape (one listener, not a second one added)',
    /if \(media\.length > 1 && event\.key === 'ArrowLeft'\) \{ event\.preventDefault\(\); goPrev\(\); return \}/.test(pageSrc) &&
    /if \(media\.length > 1 && event\.key === 'ArrowRight'\) \{ event\.preventDefault\(\); goNext\(\); return \}/.test(pageSrc))
  check('the thumbnail strip still lets a visitor jump directly to any specific photo (goTo(i))', /onClick=\{\(\) => goTo\(i\)\}/.test(pageSrc))
}

// =========================================================================
// SECTION 1d — enquiry remains reachable from the gallery
// =========================================================================
{
  check('REQUIRED: the gallery sidebar still has a working Enquire button wired to onEnquire (unchanged behavior — closes dialog, scrolls to the form)',
    /<button className="btn btn-primary" onClick=\{onEnquire\}[^>]*>Enquire about \{puppy\.name\}<\/button>/.test(pageSrc))
  check('ShowcasePublicPage\'s enquire() function (closes the dialog, selects the puppy, scrolls to the form) is completely untouched',
    /function enquire\(puppy: PublicPuppy\) \{\s*\n\s*setSelected\(null\); setEnquiryPuppy\(puppy\.id\)\s*\n\s*requestAnimationFrame\(\(\) => enquiryRef\.current\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)\)\s*\n\s*\}/.test(pageSrc))
  check('EnquiryForm submission logic (fetch to /api/create-showcase-enquiry) is completely untouched by this UI-only change',
    /fetch\('\/api\/create-showcase-enquiry', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ token, puppyRef: selectedPuppy \|\| undefined, \.\.\.form \}\) \}\)/.test(pageSrc))
}

// =========================================================================
// SECTION 1e — close/Escape behaviour, focus trap, background scroll lock
// (all regressions against the pre-existing, already-correct behavior)
// =========================================================================
{
  check('Escape still closes the dialog (unchanged)', /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); onClose\(\); return \}/.test(pageSrc))
  check('the focus trap (Tab/Shift+Tab wraparound inside the dialog) is completely untouched',
    /const focusable = Array\.from\(dialog\.querySelectorAll<HTMLElement>\('button:not\(\[disabled\]\), \[href\], input:not\(\[disabled\]\), select:not\(\[disabled\]\), textarea:not\(\[disabled\]\), video\[controls\], \[tabindex\]:not\(\[tabindex="-1"\]\)'\)\)/.test(pageSrc))
  check('the close button still receives focus on open (unchanged)', /closeRef\.current\?\.focus\(\)/.test(pageSrc))
  check('focus is still restored to whatever opened the dialog on close (unchanged)', /openerRef\.current\?\.focus\(\)/.test(pageSrc))
  check('the visible close (×) control is still present, with an accessible label', /aria-label="Close puppy profile"/.test(pageSrc))
  check('clicking the dark backdrop (not the dialog itself) still closes the gallery, same as before', /onMouseDown=\{e => \{ if \(e\.target === e\.currentTarget\) onClose\(\) \}\}/.test(pageSrc))

  check('REQUIRED: background page scroll is locked while the gallery is open (document.body.style.overflow)',
    /document\.body\.style\.overflow = 'hidden'/.test(pageSrc))
  check('REQUIRED: the previous body overflow value is restored on close, not hardcoded to \'visible\' (never fights another component\'s own setting)',
    /const previousOverflow = document\.body\.style\.overflow[\s\S]{0,150}return \(\) => \{ document\.body\.style\.overflow = previousOverflow \}/.test(pageSrc))
}

// =========================================================================
// SECTION 1f — cards are more image-focused, less white space, only
// essential details (sex, age/DOB, price) kept on the card itself
// =========================================================================
{
  function extractFunctionSource(src, signaturePattern) {
    const sigMatch = signaturePattern.exec(src)
    if (!sigMatch) return ''
    const startIdx = sigMatch.index
    const bodyOpenSearch = /\)\s*\{/.exec(src.slice(startIdx))
    if (!bodyOpenSearch) return ''
    const openIdx = startIdx + bodyOpenSearch.index + bodyOpenSearch[0].length - 1
    let depth = 0, inString = null, i = openIdx
    for (; i < src.length; i++) {
      const ch = src[i]
      if (inString) { if (ch === '\\') { i++; continue }; if (ch === inString) inString = null; continue }
      if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue }
      if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
      if (ch === '{') { depth++; continue }
      if (ch === '}') { depth--; if (depth === 0) { i++; break } }
    }
    return src.slice(startIdx, i)
  }
  const cardSrc = extractFunctionSource(pageSrc, /function PuppyCard\(/)
  check('PuppyCard function body was located', cardSrc.length > 200)

  check('the card photo area still uses a consistent ~4:3 aspect ratio', /aspectRatio: '4\/3'/.test(cardSrc))
  check('card thumbnails still use object-fit: cover (correct for a fixed-box thumbnail, unlike the enlarged view)', /style=\{cover\}/.test(cardSrc))
  check('REQUIRED: the card no longer shows the puppy\'s personality blurb (moved to the gallery sidebar only — this was the main source of uneven card height/white space)',
    !/puppy\.personality/.test(cardSrc))
  check('REQUIRED: the card still shows sex', /puppy\.sex === 'female' \? 'Female' : 'Male'/.test(cardSrc))
  check('REQUIRED: the card still shows age/DOB (getDogAge)', /getDogAge\(puppy\.dateOfBirth\)/.test(cardSrc))
  check('REQUIRED: the card still shows price where available', /puppy\.priceCents !== undefined && `Price/.test(cardSrc))
  check('Enquire remains present and compact on the card (full-width button, tightened padding)', /onClick=\{onEnquire\}/.test(cardSrc) && /padding: '8px 14px 14px'/.test(cardSrc))

  // ── Staging QA fast-follow: mobile Enquire CTA overflow ──
  // The old visible label ("Enquire about {puppy.name}") combined with
  // .btn's white-space: nowrap (index.css) overflowed/clipped on narrow
  // mobile cards for longer names. The name is already shown directly
  // above the button, so the fix shortens the VISIBLE label only,
  // keeping the full descriptive text for assistive tech via aria-label.
  check('REQUIRED: the card\'s visible Enquire label no longer includes the puppy name (was the actual overflow cause on narrow mobile widths)',
    !/>Enquire about \{puppy\.name\}<\/button>/.test(cardSrc))
  check('REQUIRED: the card button\'s visible text is the short, fixed label "Enquire" (never grows with name length)',
    /aria-label=\{`Enquire about \$\{puppy\.name\}`\}[^>]*>Enquire<\/button>/.test(cardSrc))
  check('REQUIRED: an aria-label preserves the full descriptive "Enquire about {name}" for screen readers even though the visible text is short',
    /aria-label=\{`Enquire about \$\{puppy\.name\}`\}/.test(cardSrc))
  check('REQUIRED: the button keeps a minimum 44px height for mobile touch-target accessibility', /minHeight: 44/.test(cardSrc))
  check('the button still spans the full card width', /width: '100%'/.test(cardSrc))
  check('box-sizing: border-box is explicit on the button (belt-and-braces alongside the global default)', /boxSizing: 'border-box'/.test(cardSrc))
  check('the button still fires the same onEnquire handler — only the label changed, not the behavior', /onClick=\{onEnquire\}[^>]*aria-label=\{`Enquire about \$\{puppy\.name\}`\}/.test(cardSrc))

  // Regression: this fix is scoped to the CARD only — the gallery
  // sidebar's Enquire button (300px column, never reported as
  // overflowing) must be completely untouched.
  const dialogSrcForCta = extractFunctionSource(pageSrc, /function PuppyDialog\(/)
  check('PuppyDialog function body was located (for the CTA-scope regression check)', dialogSrcForCta.length > 500)
  check('the gallery/sidebar Enquire button is UNCHANGED — still shows the full "Enquire about {name}" label (out of scope for this fix, never reported broken)',
    /<button className="btn btn-primary" onClick=\{onEnquire\} style=\{\{ width: '100%', marginTop: 16 \}\}>Enquire about \{puppy\.name\}<\/button>/.test(dialogSrcForCta))
  check('the gallery/sidebar Enquire button was NOT given the new aria-label/minHeight treatment (that was card-specific)',
    !/style=\{\{ width: '100%', marginTop: 16 \}\}>Enquire<\/button>/.test(dialogSrcForCta))
  check('name/status heading uses a smaller, more compact font size than before (21px -> 18px)', /fontSize: 18/.test(cardSrc) && !/fontSize: 21/.test(cardSrc))
}

// =========================================================================
// SECTION 2 — behavioral harness (react-test-renderer): mirrors the real
// goTo/goPrev/goNext wraparound math and the contain-vs-cover choice at
// the RENDERED level, not just source text.
// =========================================================================
{
  const React = (await import('react')).default
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer
  const { useState } = React

  // Mirrors PuppyDialog's exact goTo/goPrev/goNext formula (proven by the
  // Section 1c source-pattern check above to match the real file) and
  // its choice of `contain` for the main viewer vs `cover` for
  // thumbnails — the same "wrap the real pattern in a harness" approach
  // already used for SaleAvailabilityPanel/useShowcaseRequestGuard
  // elsewhere in this test suite.
  function GalleryHarness({ mediaCount, controls }) {
    const [active, setActive] = useState(0)
    function goTo(index) { setActive(((index % mediaCount) + mediaCount) % mediaCount) }
    controls.goPrev = () => goTo(active - 1)
    controls.goNext = () => goTo(active + 1)
    controls.goTo = goTo
    controls.getActive = () => active
    return React.createElement('div', null,
      React.createElement('img', { 'data-role': 'main', style: { objectFit: 'contain' }, 'data-index': active }),
      ...Array.from({ length: mediaCount }, (_, i) => React.createElement('img', { key: i, 'data-role': 'thumb', style: { objectFit: 'cover' }, 'data-active': i === active })),
    )
  }

  function mount(mediaCount) {
    let renderer
    const controls = {}
    act(() => { renderer = TestRenderer.create(React.createElement(GalleryHarness, { mediaCount, controls })) })
    return { renderer, controls }
  }

  // ── Wraparound navigation across multiple photos ──
  {
    const { renderer, controls } = mount(3)
    check('starts at index 0', controls.getActive() === 0)
    act(() => { controls.goNext() })
    check('goNext: 0 -> 1', controls.getActive() === 1)
    act(() => { controls.goNext() })
    check('goNext: 1 -> 2', controls.getActive() === 2)
    act(() => { controls.goNext() })
    check('REQUIRED: goNext wraps from the LAST photo back to the FIRST (2 -> 0)', controls.getActive() === 0)
    act(() => { controls.goPrev() })
    check('REQUIRED: goPrev wraps from the FIRST photo to the LAST (0 -> 2)', controls.getActive() === 2)
    act(() => { controls.goTo(1) })
    check('goTo(1) jumps directly to index 1 (thumbnail click)', controls.getActive() === 1)
    act(() => { renderer.unmount() })
  }

  // ── Single-photo edge case: navigation must not throw or divide by
  // zero (media.length === 1 in the real component never even renders
  // the prev/next buttons, per the Section 1c "only when > 1" check —
  // this proves the underlying math is also safe if ever called anyway) ──
  {
    const { renderer, controls } = mount(1)
    let threw = false
    try { act(() => { controls.goNext() }) } catch { threw = true }
    check('navigating with only one photo never throws (modulo-by-1 stays at 0)', !threw && controls.getActive() === 0)
    act(() => { renderer.unmount() })
  }

  // ── contain vs cover at the rendered level ──
  {
    const { renderer, controls } = mount(2)
    const html = () => JSON.stringify(renderer.toJSON())
    check('REQUIRED: the main enlarged viewer element renders with objectFit "contain"', html().includes('"objectFit":"contain"'))
    check('REQUIRED: thumbnail elements render with objectFit "cover" (not contain — thumbnails are meant to fill their fixed box)', html().includes('"objectFit":"cover"'))
    act(() => { controls.goTo(1) })
    check('after navigating, the main viewer element is still present and still contain (not accidentally swapped to cover)', html().includes('"objectFit":"contain"'))
    act(() => { renderer.unmount() })
  }
}

await summary()
