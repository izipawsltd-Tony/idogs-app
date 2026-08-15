import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fetchPublishedLandingMedia, type LandingSlotId, type PublishedLandingMedia } from '../lib/landingMedia'

// ── iDogs Landing Page V2 (STAGING ONLY) ─────────────────────────
// Ported from the approved design-review package:
//   iDogs_Landing_V2_Brief_DRAFT_FOR_PROTOTYPE (1).md (copy/product truth)
//   idogs_landing_v2_prototype (3).html (layout/CSS/accessibility pattern)
// Brief's own status line: "DRAFT for Design Review. NOT APPROVED FOR
// PUBLICATION." — approved for THIS staging implementation only, per
// explicit task instruction; still not approved for production.
//
// Pricing and FAQ are deliberately absent (hidden per brief §2/§8/§13 —
// no verified prices/inclusions/answers yet). No Watch-Demo/video
// lightbox (brief §9 — removed, opened an empty placeholder). No
// unverified feature claim (ownership transfer, buyer enquiries, public
// puppy profiles, per-field QR control, Forever Record detail, AI
// quota, testimonials/stats) appears anywhere below — see brief §7.
//
// All CSS below is scoped under `.lv2-page` (never :root/html/body/bare
// element selectors) so nothing here can leak into or collide with the
// rest of the app's existing global stylesheet (index.css already
// defines its own unrelated .btn/.btn-primary/etc. — confirmed by
// direct inspection before writing this file).
export default function LandingPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const pageContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loading && user) navigate('/app/dashboard')
  }, [user, loading])

  // Background must be inert + non-scrollable while the mobile menu is
  // open — mirrors the approved prototype's makeOverlay() behaviour
  // (inert the whole page-content wrapper, not a hand-maintained list of
  // sections, so nothing is ever missed) and this codebase's own
  // established overlay pattern (ShowcasePublicPage.tsx's PuppyDialog).
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
      pageContentRef.current?.setAttribute('inert', '')
    } else {
      document.body.style.overflow = previousOverflow
      pageContentRef.current?.removeAttribute('inert')
    }
    return () => { document.body.style.overflow = previousOverflow }
  }, [menuOpen])

  return (
    <div className="lv2-page">
      <style>{LV2_CSS}</style>

      <div ref={pageContentRef} id="lv2-page-content">
        <header className="nav">
          <div className="nav-inner wrap">
            <a href="#top" className="brand-logo" aria-label="iDogs home">
              <img src="/03_idogs_reversed_white_transparent.png" alt="iDogs" style={{ width: 125, height: 'auto' }} />
            </a>
            <nav className="nav-links" aria-label="Primary">
              <a href="#features">Features</a>
              <a href="#for-owners">For Owners</a>
              <a href="#for-breeders">For Breeders</a>
            </nav>
            <div className="nav-right">
              <Link className="nav-login" to="/login">Log In</Link>
              <Link className="btn nav-cta" to="/signup">Start Free</Link>
              <button
                className="hamburger"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                aria-controls="lv2-mobile-menu"
                onClick={() => setMenuOpen(true)}
              >☰</button>
            </div>
          </div>
        </header>

        <main>
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow">Australian dog record-keeping</p>
              <h1>Every dog's story, connected for life.</h1>
              <p className="sub">An organised digital record for every dog — identity, health records and documents in one place.</p>
              <p className="aud">For Australian dog owners and breeders.</p>
              <p className="incl">Whether you care for dogs or manage a breeding program.</p>
              <div className="cta-row">
                <Link className="btn btn-primary" to="/signup">Start Free</Link>
                <a className="btn btn-ghost" href="#howitworks">See How It Works</a>
              </div>
            </div>
            {/* Hero product composition — placeholder, pending real product screenshots (brief §9/§10) */}
            <div className="hero-visual" aria-label="iDogs product preview">
              <div className="hv-poster">
                <LandingMediaSlot
                  slotId="hero"
                  className="hv-shot"
                  ariaLabel="iDogs product preview"
                  fallback={<div className="hv-shot">Dog Profile — product screenshot</div>}
                />
              </div>
              <div className="hv-strip">
                <div className="hv-mini">
                  <LandingMediaSlot
                    slotId="digital-passport"
                    className="m"
                    ariaLabel="Digital Passport and QR preview"
                    fallback={<div className="m">Digital Passport / QR</div>}
                  />
                </div>
                <div className="hv-mini">
                  <LandingMediaSlot
                    slotId="puppy-showcase"
                    className="m"
                    ariaLabel="Mobile Puppy Showcase preview"
                    fallback={<div className="m">Mobile preview</div>}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="trust">
          <div className="trust-inner">
            <span className="trust-item"><span className="tick">✓</span> Australian-owned</span>
            <span className="trust-item"><span className="tick">✓</span> Built for dog owners</span>
            <span className="trust-item"><span className="tick">✓</span> Designed for breeders</span>
            <span className="trust-item"><span className="tick">✓</span> Start free</span>
          </div>
        </div>

        <section className="block" id="features">
          <div className="wrap">
            <p className="kicker">A quick look</p>
            <h2>An organised digital record for every dog.</h2>
            <p className="lead">A connected record from a dog's first day onward — profile, documents and a Digital Passport in one place.</p>
            <div className="shots">
              <div>
                <div className="frame-desktop"><div className="bar"><i></i><i></i><i></i></div>
                  <LandingMediaSlot
                    slotId="dog-profile"
                    className="ph ph-desktop"
                    ariaLabel="Dog records in one organised profile"
                    fallback={<div className="ph ph-desktop" role="img" aria-label="Dog records in one organised profile (product screenshot to follow)">Dog Profile &amp; records</div>}
                  /></div>
                <div className="shot-cap">Dog records in one organised profile</div>
              </div>
              <div>
                <div className="frame-mobile"><div className="bar"><i></i><i></i><i></i></div>
                  <LandingMediaSlot
                    slotId="puppy-showcase"
                    className="ph ph-mobile"
                    ariaLabel="A mobile-friendly Puppy Showcase"
                    fallback={<div className="ph ph-mobile" role="img" aria-label="A mobile-friendly Puppy Showcase (product screenshot to follow)">Puppy Showcase</div>}
                  /></div>
                <div className="shot-cap">A mobile-friendly Puppy Showcase</div>
              </div>
              <div>
                <div className="frame-mobile"><div className="bar"><i></i><i></i><i></i></div>
                  <LandingMediaSlot
                    slotId="digital-passport"
                    className="ph ph-mobile"
                    ariaLabel="A limited public Passport view"
                    fallback={<div className="ph ph-mobile" role="img" aria-label="A limited public Passport view (product screenshot to follow)">Digital Passport / QR</div>}
                  /></div>
                <div className="shot-cap">A limited public Passport view</div>
              </div>
            </div>
          </div>
        </section>

        <section className="block alt" id="paths">
          <div className="wrap">
            <p className="kicker">Who it's for</p>
            <h2>Find the part of iDogs that fits you.</h2>
            <div className="paths">
              <div className="path" id="for-owners">
                <h3>For Dog Owners</h3>
                <p className="plead">Keep your dog's records organised in one place.</p>
                <ul>
                  <li>Digital dog profile</li>
                  <li>Health and vaccination records</li>
                  <li>QR sharing</li>
                </ul>
                <Link className="btn btn-path" to="/signup">Start Free as a Dog Owner</Link>
              </div>
              <div className="path" id="for-breeders">
                <h3>For Breeders</h3>
                <p className="plead">A simpler way to manage each litter.</p>
                <ul>
                  <li>Manage dogs and litters</li>
                  <li>Create a Puppy Showcase</li>
                  <li>Add puppy photos</li>
                </ul>
                <Link className="btn btn-path" to="/signup">Start Free as a Breeder</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="passport">
          <div className="wrap">
            <p className="kicker">The record</p>
            <h2>One Digital Passport for Life</h2>
            <p className="lead">An organised record that stays connected through every stage of a dog's life.</p>
            <div className="pillars">
              <div className="pillar"><h4>Identity &amp; microchip</h4><p>A connected identity record through every life stage.</p></div>
              <div className="pillar"><h4>Health &amp; vaccination</h4><p>Health records kept in one place.</p></div>
              <div className="pillar"><h4>Documents</h4><p>Keep important document copies together.</p></div>
              <div className="pillar"><h4>QR sharing</h4><p>A limited public view for selected information.</p></div>
            </div>
            <div className="life">
              <p className="kicker">Through every stage</p>
              <ol className="life-row">
                <li className="life-stage"><div className="life-connector"></div><div className="dot"></div><h4>Birth</h4></li>
                <li className="life-stage"><div className="life-connector"></div><div className="dot"></div><h4>Puppy</h4></li>
                <li className="life-stage"><div className="life-connector"></div><div className="dot"></div><h4>Adult</h4></li>
                <li className="life-stage"><div className="life-connector"></div><div className="dot"></div><h4>Senior</h4></li>
                <li className="life-stage forever"><div className="dot"></div><h4>Later Life</h4></li>
              </ol>
            </div>
          </div>
        </section>

        <section className="block alt">
          <div className="wrap">
            <p className="kicker">For breeders</p>
            <h2>Four simple steps to keep each dog's records connected.</h2>
            <ol className="flow" aria-label="Puppy Showcase workflow">
              <li className="flow-step"><span className="n">1</span> Create litter</li>
              <li className="flow-step"><span className="n">2</span> Add puppies</li>
              <li className="flow-step"><span className="n">3</span> Add photos</li>
              <li className="flow-step"><span className="n">4</span> Publish Showcase</li>
            </ol>
            <p className="lead"><strong>Show every puppy beautifully.</strong></p>
            <div className="showcase-feats">
              <span>Shareable public link</span><span>Photos</span>
              <span>Mobile-friendly viewing</span>
            </div>
          </div>
        </section>

        <section className="block" id="howitworks">
          <div className="wrap">
            <div className="ai-card">
              <div>
                <h3>AI Document Scan</h3>
                <p>Turn dog documents into organised records faster. Upload a supported document and iDogs will extract key details for you to review before saving.</p>
                <span className="ai-note">Review extracted information before saving.</span>
              </div>
              <ol className="ai-flow" aria-label="AI Document Scan steps">
                <li><span className="n">1</span> Upload a supported document</li>
                <li><span className="n">2</span> iDogs extracts key details</li>
                <li><span className="n">3</span> You review and edit</li>
                <li><span className="n">4</span> Save to the dog's record</li>
              </ol>
            </div>
            <p className="kicker">How it works</p>
            <h2>Three simple steps to keep each dog's records connected.</h2>
            <div className="steps steps-3">
              <div className="step"><div className="n">1</div><h4>Create the dog's profile</h4></div>
              <div className="step ai-here"><div className="n">2</div><h4>Add records and documents</h4><span className="tag">AI Scan lives here</span></div>
              <div className="step"><div className="n">3</div><h4>Share selected information when needed</h4></div>
            </div>
          </div>
        </section>

        {/* Pricing section intentionally absent — hidden until real prices/inclusions are verified (brief §2/§8) */}
        {/* FAQ section intentionally absent — no answer verified against the real product yet (brief §13) */}

        <section className="final">
          <div className="wrap">
            <h2>Give every dog a connected record for life.</h2>
            <p>Built for Australian dog owners and breeders. Start free.</p>
            <Link className="btn btn-primary" to="/signup">Start Free</Link>
          </div>
        </section>
        </main>

        <footer>
          <div className="wrap">
            <div className="foot-top">
              <div className="foot-brand">
                <img src="/03_idogs_reversed_white_transparent.png" alt="iDogs" style={{ width: 125, height: 'auto' }} />
                <div style={{ maxWidth: '34ch', marginTop: 12, color: 'var(--on-forest-soft)' }}>An organised digital record for every dog.</div>
              </div>
              <div className="foot-cols">
                <div className="foot-col">
                  <h5>Product</h5>
                  <a href="#features">Features</a>
                  <a href="#for-owners">For Owners</a>
                  <a href="#for-breeders">For Breeders</a>
                </div>
                <div className="foot-col">
                  <h5>Account</h5>
                  <Link to="/login">Log In</Link>
                  <Link to="/signup">Start Free</Link>
                </div>
                <div className="foot-col">
                  <h5>Legal</h5>
                  <Link to="/privacy">Privacy Policy</Link>
                  <Link to="/terms">Terms of Use</Link>
                  <a href="mailto:hello@idogs.com.au">Contact / Support</a>
                </div>
              </div>
            </div>
            <p className="foot-legal">iDogs provides record-management tools and does not constitute legal or regulatory advice. Breeders remain responsible for meeting applicable state, local council and registry requirements. <em>(Disclaimer pending legal review.)</em></p>
            <p className="foot-copy">© 2026 iDogs. All rights reserved.</p>
          </div>
        </footer>

        <div className="sticky-cta">
          <Link className="btn btn-primary" to="/signup">Start Free</Link>
        </div>
      </div>

      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} />}
    </div>
  )
}

// ── MOBILE MENU (accessible overlay) ─────────────────────────────
// Focus trap / Escape-to-close / focus-restore pattern mirrors this
// codebase's own established overlay implementation
// (ShowcasePublicPage.tsx's PuppyDialog) rather than reinventing one:
// openerRef captures whatever had focus the instant this mounts (the
// hamburger button, since that's what was just clicked), closeRef gets
// initial focus, Tab/Shift+Tab wraps within the panel's own focusable
// elements, Escape closes, and focus returns to the opener on unmount.
function MobileMenu({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useEffect(() => {
    closeRef.current?.focus()
    const panel = panelRef.current
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) { event.preventDefault(); panel.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Deferred to the next frame: LandingPage's own effect removes
      // `inert` from the page-content wrapper (which contains the
      // hamburger button) in this same passive-effects flush, and an
      // inert element cannot receive focus. Waiting a frame guarantees
      // that removal has already committed before we try to focus it.
      requestAnimationFrame(() => openerRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  return (
    <div className="m-overlay open" id="lv2-mobile-menu" aria-hidden="false" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panelRef} className="m-panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="m-top">
          <img src="/03_idogs_reversed_white_transparent.png" alt="iDogs" style={{ width: 104.2, height: 'auto' }} />
          <button ref={closeRef} className="m-close" aria-label="Close menu" onClick={onClose}>✕</button>
        </div>
        <a href="#features" onClick={onClose}>Features</a>
        <a href="#for-owners" onClick={onClose}>For Owners</a>
        <a href="#for-breeders" onClick={onClose}>For Breeders</a>
        <Link to="/login" style={{ border: 'none' }} onClick={onClose}>Log In</Link>
        <Link className="btn btn-primary" to="/signup" onClick={onClose}>Start Free</Link>
      </div>
    </div>
  )
}

// ── LANDING MEDIA SLOT (public rendering) ─────────────────────────
// Renders one of the four Super-Admin-managed landing slots (see
// src/pages/LandingMediaAdminPage.tsx and api/manage-landing-media.js).
// Fetches the PUBLISHED config only (never a draft — drafts are never
// client-readable at all, see firestore.rules) via a plain public
// Firestore read, so new content shows up on the next normal page load
// with no code change or redeploy.
//
// Reuses the caller's OWN placeholder className (e.g. "hv-shot", "ph
// ph-desktop") directly on the rendered <img>/<video> — those classes
// already define the exact aspect-ratio/border-radius/background this
// slot must fill, so no new CSS is needed; object-fit:cover (added
// inline, since the placeholder classes never needed it before) is what
// makes a real image/video fill that same box cleanly.
//
// Falls back to the caller's exact original placeholder markup — never a
// blank or broken box — whenever: nothing has been published yet, the
// Firestore read fails, or the image/video itself fails to load
// (onError). This is the ONLY thing that decides what's shown; there is
// no separate "loading" flicker state, since the fallback IS a
// legitimate, finished visual (the existing placeholder), not a spinner.
function LandingMediaSlot({ slotId, className, ariaLabel, fallback }: {
  slotId: LandingSlotId
  className: string
  ariaLabel: string
  fallback: ReactNode
}) {
  const [media, setMedia] = useState<PublishedLandingMedia | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMedia(null)
    setFailed(false)
    fetchPublishedLandingMedia(slotId).then(result => {
      if (!cancelled) setMedia(result)
    })
    return () => { cancelled = true }
  }, [slotId])

  if (!media || failed) return <>{fallback}</>

  const fillStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }

  if (media.kind === 'video') {
    return (
      <video
        className={className}
        style={fillStyle}
        src={media.url}
        aria-label={ariaLabel}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <img
      className={className}
      style={fillStyle}
      src={media.url}
      alt={ariaLabel}
      onError={() => setFailed(true)}
    />
  )
}

// ── SCOPED CSS ─────────────────────────────────────────────────
// Every rule below is prefixed under `.lv2-page` (or `.lv2-page` IS the
// selector) — nothing here is a bare/global element or :root selector,
// so it cannot leak into or be overridden by the rest of the app's
// existing global stylesheet (index.css), and nothing from index.css's
// own .btn/.btn-primary/etc. can bleed into this page either, since
// `.lv2-page .btn-primary` (two classes) always outranks a bare
// `.btn-primary` (one class) in specificity regardless of source order.
const LV2_CSS = `
  .lv2-page {
    --forest:#16302B; --forest-2:#21453D; --bone:#F5F1E8; --bone-2:#EAE3D3;
    --brass:#C08A2D; --brass-lo:#9C6E1F;
    --ink:#14231F; --ink-soft:#4A5A54; --line:#D6CDB8;
    --on-forest:#EFE9DA; --on-forest-soft:#A9BDB4;
    --radius:14px; --maxw:1180px;
    margin:0; font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    color:var(--ink); background:var(--bone); line-height:1.55; -webkit-font-smoothing:antialiased;
  }
  .lv2-page *, .lv2-page *::before, .lv2-page *::after { box-sizing:border-box; }
  @media (prefers-reduced-motion: reduce){ .lv2-page * { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
  .lv2-page [inert] { pointer-events:none; }
  .lv2-page h1, .lv2-page h2, .lv2-page h3, .lv2-page .display { font-family:'Fraunces','Georgia',serif; font-weight:600; line-height:1.08; letter-spacing:-0.01em; }
  .lv2-page .wrap { max-width:var(--maxw); margin:0 auto; padding:0 24px; }
  .lv2-page a:focus-visible, .lv2-page button:focus-visible, .lv2-page [tabindex]:focus-visible { outline:3px solid var(--brass); outline-offset:2px; border-radius:6px; }
  .lv2-page .btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px; border-radius:999px; font-family:inherit; font-weight:700; cursor:pointer; text-decoration:none; border:none; }

  .lv2-page header.nav { position:sticky; top:0; z-index:40; background:rgba(22,48,43,.94); backdrop-filter:blur(8px); }
  .lv2-page .nav-inner { display:flex; align-items:center; justify-content:space-between; padding:12px 24px; max-width:var(--maxw); margin:0 auto; gap:16px; }
  .lv2-page .brand-logo { display:inline-flex; align-items:center; }
  .lv2-page .nav-links { display:flex; gap:24px; align-items:center; font-size:14px; }
  .lv2-page .nav-links a { text-decoration:none; color:var(--on-forest-soft); }
  .lv2-page .nav-links a:hover, .lv2-page .nav-links a:focus-visible { color:var(--on-forest); }
  .lv2-page .nav-right { display:flex; align-items:center; gap:14px; }
  .lv2-page .nav-login { text-decoration:none; color:var(--on-forest-soft); font-size:14px; display:inline-flex; align-items:center; min-height:44px; padding:0 6px; }
  .lv2-page .nav-login:hover { color:var(--on-forest); }
  .lv2-page .nav-cta { background:var(--brass); color:var(--forest); padding:10px 18px; font-size:14px; font-weight:800; }
  .lv2-page .nav-cta:hover { background:#d29a3c; }
  .lv2-page .hamburger { display:none; background:none; border:1px solid var(--on-forest-soft); border-radius:8px; color:var(--on-forest); min-height:44px; min-width:44px; padding:10px; cursor:pointer; font-size:18px; align-items:center; justify-content:center; }

  .lv2-page .m-overlay { display:none; position:fixed; inset:0; z-index:60; background:rgba(10,20,17,.6); }
  .lv2-page .m-overlay.open { display:block; }
  .lv2-page .m-panel { position:absolute; top:0; right:0; width:min(84vw,340px); height:100%; background:var(--forest); color:var(--on-forest); padding:20px; display:flex; flex-direction:column; gap:2px; box-shadow:-20px 0 60px -20px rgba(0,0,0,.7); }
  .lv2-page .m-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .lv2-page .m-panel a { color:var(--on-forest); text-decoration:none; padding:14px 8px; border-bottom:1px solid rgba(255,255,255,.08); font-size:16px; min-height:44px; display:flex; align-items:center; }
  .lv2-page .m-panel .btn { margin-top:14px; }
  .lv2-page .m-close { background:none; border:1px solid var(--on-forest-soft); border-radius:8px; color:var(--on-forest); min-height:44px; min-width:44px; cursor:pointer; font-size:18px; }

  .lv2-page .hero { background:var(--forest); color:var(--on-forest); padding:76px 0 64px; position:relative; overflow:hidden; }
  .lv2-page .hero:before { content:""; position:absolute; inset:0; background:radial-gradient(700px 380px at 82% -8%, rgba(192,138,45,.20), transparent 60%); pointer-events:none; }
  .lv2-page .hero-grid { display:grid; grid-template-columns:1.12fr .88fr; gap:48px; align-items:center; position:relative; }
  .lv2-page .eyebrow { font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--brass); font-weight:700; margin-bottom:18px; }
  .lv2-page .hero h1 { font-size:clamp(38px,5vw,60px); margin:0 0 20px; }
  .lv2-page .hero .sub { font-size:19px; color:var(--on-forest-soft); max-width:34ch; margin:0 0 10px; }
  .lv2-page .hero .aud { font-size:15px; color:var(--on-forest); font-weight:600; margin:14px 0 4px; }
  .lv2-page .hero .incl { font-size:14px; color:var(--on-forest-soft); margin:0 0 28px; }
  .lv2-page .cta-row { display:flex; gap:14px; flex-wrap:wrap; }
  .lv2-page .btn-primary { background:var(--brass); color:var(--forest); padding:15px 28px; font-size:16px; font-weight:800; box-shadow:0 10px 30px -12px rgba(192,138,45,.6); }
  .lv2-page .btn-primary:hover { background:#d29a3c; transform:translateY(-1px); }
  .lv2-page .btn-ghost { background:transparent; color:var(--on-forest); border:1.5px solid var(--on-forest-soft); padding:15px 24px; font-size:16px; font-weight:700; }
  .lv2-page .btn-ghost:hover { border-color:var(--on-forest); }

  .lv2-page .hero-visual { background:linear-gradient(160deg,var(--forest-2),#1a3a33); border:1px solid rgba(192,138,45,.4); border-radius:18px; padding:16px; box-shadow:0 24px 60px -30px rgba(0,0,0,.7); }
  .lv2-page .hv-poster { position:relative; border-radius:12px; overflow:hidden; }
  .lv2-page .hv-shot { aspect-ratio:16/11; background:repeating-linear-gradient(135deg,#274a42 0 14px,#22443c 14px 28px); display:grid; place-items:center; text-align:center; color:var(--on-forest-soft); font-size:13px; padding:16px; }
  .lv2-page .hv-strip { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
  .lv2-page .hv-mini { background:var(--forest); border-radius:8px; padding:6px; }
  .lv2-page .hv-mini .m { aspect-ratio:9/6; background:repeating-linear-gradient(135deg,#2b4c44 0 10px,#264640 10px 20px); border-radius:5px; display:grid; place-items:center; font-size:11px; color:var(--on-forest-soft); text-align:center; padding:6px; }
  .lv2-page .hv-mini img.m, .lv2-page .hv-mini video.m { object-fit:cover!important; object-position:center top; background:var(--forest); padding:0; }

  .lv2-page .trust { background:var(--bone-2); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .lv2-page .trust-inner { display:flex; flex-wrap:wrap; gap:14px 40px; justify-content:center; padding:18px 24px; max-width:var(--maxw); margin:0 auto; }
  .lv2-page .trust-item { display:flex; align-items:center; gap:9px; font-size:14px; font-weight:600; color:var(--ink-soft); }
  .lv2-page .trust-item .tick { color:var(--brass-lo); font-weight:900; }

  .lv2-page section.block { padding:72px 0; scroll-margin-top:80px; }
  .lv2-page section.block.alt { background:var(--bone-2); }
  .lv2-page .path { scroll-margin-top:80px; }
  .lv2-page .kicker { font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--brass-lo); font-weight:700; margin-bottom:12px; }
  .lv2-page .block h2 { font-size:clamp(28px,3.4vw,40px); margin:0 0 14px; max-width:24ch; }
  .lv2-page .lead { font-size:17px; color:var(--ink-soft); max-width:62ch; margin:0; }

  .lv2-page .shots { display:grid; grid-template-columns:1.6fr 1fr 1fr; gap:22px; align-items:end; margin-top:20px; }
  .lv2-page .frame-desktop, .lv2-page .frame-mobile { background:var(--forest); border-radius:14px; padding:10px; box-shadow:0 20px 50px -28px rgba(0,0,0,.5); }
  .lv2-page .frame-desktop .bar, .lv2-page .frame-mobile .bar { display:flex; gap:5px; padding:5px 4px 8px; }
  .lv2-page .frame-desktop .bar i, .lv2-page .frame-mobile .bar i { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.35); }
  .lv2-page .ph { width:100%; background:repeating-linear-gradient(135deg,var(--bone-2) 0 12px,#e2dac7 12px 24px); border-radius:8px; display:grid; place-items:center; text-align:center; color:var(--ink-soft); font-size:13px; font-weight:600; padding:16px; }
  .lv2-page .ph-desktop { aspect-ratio:16/10; }
  .lv2-page .ph-mobile { aspect-ratio:3/5; }
  .lv2-page .frame-mobile img.ph-mobile, .lv2-page .frame-mobile video.ph-mobile { object-fit:contain!important; background:var(--bone-2); padding:0; }
  .lv2-page .shot-cap { text-align:center; font-size:13px; color:var(--ink-soft); margin-top:10px; }

  .lv2-page .paths { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:20px; }
  .lv2-page .path { background:var(--bone); border:1px solid var(--line); border-radius:var(--radius); padding:30px 28px; }
  .lv2-page section.block.alt .path { background:#fff; }
  .lv2-page .path h3 { font-size:23px; margin:0 0 8px; }
  .lv2-page .path .plead { font-size:15px; color:var(--ink-soft); margin:0 0 18px; }
  .lv2-page .path ul { list-style:none; margin:0 0 22px; padding:0; }
  .lv2-page .path li { padding:8px 0 8px 26px; position:relative; font-size:15px; border-top:1px solid var(--line); }
  .lv2-page .path li:first-child { border-top:none; }
  .lv2-page .path li:before { content:"→"; position:absolute; left:0; color:var(--brass-lo); font-weight:800; }
  .lv2-page .btn-path { background:var(--forest); color:var(--on-forest); padding:12px 22px; font-size:15px; font-weight:700; }
  .lv2-page .btn-path:hover { background:var(--forest-2); }

  .lv2-page .pillars { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:20px; }
  .lv2-page .pillar { background:var(--bone); border:1px solid var(--line); border-radius:var(--radius); padding:22px; }
  .lv2-page section.block.alt .pillar { background:#fff; }
  .lv2-page .pillar h4 { font-family:'Fraunces',serif; font-size:17px; margin:0 0 6px; }
  .lv2-page .pillar p { margin:0; font-size:14px; color:var(--ink-soft); }

  .lv2-page .life { margin-top:40px; }
  .lv2-page .life-row { display:flex; align-items:stretch; gap:0; list-style:none; padding:0; margin:0; }
  .lv2-page .life-stage { flex:1; text-align:center; padding:20px 10px; position:relative; }
  .lv2-page .life-stage .dot { width:16px; height:16px; border-radius:50%; background:var(--brass); margin:0 auto 12px; box-shadow:0 0 0 5px rgba(192,138,45,.18); }
  .lv2-page .life-stage.forever .dot { background:var(--forest); box-shadow:0 0 0 5px rgba(22,48,43,.14); }
  .lv2-page .life-stage h4 { font-family:'Fraunces',serif; font-size:17px; margin:0; }
  .lv2-page .life-connector { position:absolute; top:47px; left:50%; width:100%; height:2px; background:var(--line); z-index:0; }
  .lv2-page .life-stage:last-child .life-connector { display:none; }

  .lv2-page .flow { display:flex; flex-wrap:wrap; gap:10px; margin:22px 0; padding:0; list-style:none; }
  .lv2-page .flow-step { background:var(--forest); color:var(--on-forest); border-radius:999px; padding:10px 16px; font-size:14px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .lv2-page .flow-step .n { color:var(--brass); font-weight:800; }
  .lv2-page .flow-step:not(:last-child)::after { content:"→"; color:var(--brass-lo); font-weight:800; margin-left:14px; }
  .lv2-page .showcase-feats { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .lv2-page .showcase-feats span { font-size:13px; padding:6px 12px; background:var(--bone); border:1px solid var(--line); border-radius:8px; }
  .lv2-page section.block.alt .showcase-feats span { background:#fff; }

  .lv2-page .ai-card { background:var(--forest); color:var(--on-forest); border-radius:var(--radius); padding:30px; margin-bottom:26px; display:grid; grid-template-columns:1.3fr 1fr; gap:26px; align-items:center; }
  .lv2-page .ai-card h3 { font-size:22px; margin:0 0 8px; color:var(--on-forest); }
  .lv2-page .ai-card p { color:var(--on-forest-soft); margin:0 0 12px; font-size:15px; }
  .lv2-page .ai-note { display:inline-block; background:rgba(192,138,45,.16); border:1px solid var(--brass); color:var(--bone); font-size:13px; font-weight:600; padding:7px 13px; border-radius:8px; }
  .lv2-page .ai-flow { display:flex; flex-direction:column; gap:8px; list-style:none; padding:0; margin:0; }
  .lv2-page .ai-flow li { background:rgba(245,241,232,.06); border:1px solid rgba(245,241,232,.14); border-radius:8px; padding:10px 14px; font-size:14px; display:flex; align-items:center; gap:10px; color:var(--on-forest); }
  .lv2-page .ai-flow li .n { color:var(--brass); font-weight:800; }
  .lv2-page .steps { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
  .lv2-page .steps.steps-3 { grid-template-columns:repeat(3,1fr); }
  .lv2-page .step { background:var(--bone); border:1px solid var(--line); border-radius:var(--radius); padding:20px; }
  .lv2-page section.block.alt .step { background:#fff; }
  .lv2-page .step .n { font-family:'Fraunces',serif; color:var(--brass-lo); font-size:26px; }
  .lv2-page .step h4 { font-size:15px; margin:6px 0 0; }
  .lv2-page .step.ai-here { border-color:var(--brass); box-shadow:0 0 0 1px var(--brass); }
  .lv2-page .step .tag { display:inline-block; margin-top:8px; font-size:11px; font-weight:700; color:var(--brass-lo); text-transform:uppercase; letter-spacing:.05em; }

  .lv2-page .final { background:var(--forest); color:var(--on-forest); text-align:center; padding:76px 0; }
  .lv2-page .final h2 { font-size:clamp(28px,3.6vw,42px); margin:0 0 12px; }
  .lv2-page .final p { color:var(--on-forest-soft); margin:0 0 26px; font-size:17px; }

  .lv2-page footer { background:#0f221e; color:var(--on-forest-soft); padding:44px 0 40px; font-size:14px; }
  .lv2-page .foot-top { display:flex; justify-content:space-between; flex-wrap:wrap; gap:30px; }
  .lv2-page .foot-col h5 { color:var(--on-forest); font-size:13px; letter-spacing:.05em; text-transform:uppercase; margin:0 0 12px; }
  .lv2-page .foot-col a, .lv2-page .foot-col span { display:block; color:var(--on-forest-soft); text-decoration:none; padding:7px 0; min-height:auto; font-size:14px; }
  .lv2-page .foot-col a:hover { color:var(--on-forest); }
  .lv2-page .foot-col .pending { color:#6f847c; font-size:12.5px; }
  .lv2-page .foot-cols { display:flex; gap:56px; flex-wrap:wrap; }
  .lv2-page .foot-legal { max-width:64ch; margin-top:26px; padding-top:18px; border-top:1px solid rgba(255,255,255,.08); font-size:12.5px; color:#6f847c; }
  .lv2-page .foot-copy { margin-top:10px; font-size:12.5px; color:#6f847c; }

  .lv2-page .sticky-cta { display:none; position:fixed; bottom:0; left:0; right:0; z-index:50; background:rgba(22,48,43,.97); padding:12px 16px; padding-bottom:calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--brass-lo); }
  .lv2-page .sticky-cta .btn { width:100%; }

  @media (max-width:900px){
    .lv2-page .hero-grid{grid-template-columns:1fr;gap:34px;}
    .lv2-page .shots{grid-template-columns:1fr;justify-items:center;}
    .lv2-page .frame-desktop, .lv2-page .frame-mobile{max-width:420px;width:100%;}
    .lv2-page .paths{grid-template-columns:1fr;}
    .lv2-page .pillars{grid-template-columns:1fr 1fr;}
    .lv2-page .steps{grid-template-columns:1fr 1fr;}
    .lv2-page .steps.steps-3{grid-template-columns:1fr 1fr;}
    .lv2-page .ai-card{grid-template-columns:1fr;}
    .lv2-page .nav-links{display:none;}
    .lv2-page .nav-right .nav-login{display:none;}
    .lv2-page .hamburger{display:inline-flex;}
  }
  @media (max-width:620px){
    .lv2-page section.block{padding:52px 0;}
    .lv2-page .hero{padding:52px 0 44px;}
    .lv2-page .pillars{grid-template-columns:1fr;}
    .lv2-page .steps, .lv2-page .steps.steps-3{grid-template-columns:1fr;}
    .lv2-page .life-row{flex-direction:column;gap:12px;}
    .lv2-page .life-stage{text-align:left;display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bone);border:1px solid var(--line);border-radius:10px;}
    .lv2-page section.block.alt .life-stage{background:#fff;}
    .lv2-page .life-stage .dot{margin:0;flex:none;}
    .lv2-page .life-connector{display:none;}
    .lv2-page .flow{flex-direction:column;}
    .lv2-page .flow-step:not(:last-child)::after{display:none;}
    .lv2-page .flow-step{width:100%;}
    .lv2-page .foot-cols{gap:30px;}
    .lv2-page .sticky-cta{display:block;}
    .lv2-page .final, .lv2-page footer{padding-bottom:90px;}
  }
  @media (max-width:390px){ .lv2-page .wrap{padding:0 18px;} .lv2-page .hero h1{font-size:33px;} }
`
