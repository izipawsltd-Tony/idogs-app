import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fetchPublishedLandingMedia, type LandingSlotId, type PublishedLandingMedia } from '../lib/landingMedia'
import { PLUS_MONTHLY_PRICE_AUD, LITTER_QUOTA_PLUS_ROLLING_12_MONTHS, EXTRA_LITTER_PRICE_AUD, DOG_CAP_FREE, DOG_CAP_PLUS, SCAN_QUOTA_FREE_LIFETIME, SCAN_QUOTA_PLUS_MONTHLY } from '../lib/pricingCopy'
import { trackLandingEvent } from '../lib/landingEvents'
import PlusPromotion, { usePlusPromotion } from '../components/ui/PlusPromotion'
import { LaunchCountdownLine, useOfferStatus } from '../components/billing/LaunchOfferCard'

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
const FAST_LANDING_MEDIA: Partial<Record<LandingSlotId, { localSrc: string; publishedUrl: string }>> = {
  'dog-profile': {
    localSrc: '/landing-media-fast/dog-profile.webp',
    publishedUrl: 'https://storage.googleapis.com/idogs-app.firebasestorage.app/landing-media/dog-profile/published/8eab97d1-5e79-4852-ab53-5c508e11a868.jpg',
  },
  'puppy-showcase': {
    localSrc: '/landing-media-fast/puppy-showcase.webp',
    publishedUrl: 'https://storage.googleapis.com/idogs-app.firebasestorage.app/landing-media/puppy-showcase/published/2a6c4588-21bd-4ee3-87e6-e4346a579353.png',
  },
  'digital-passport': {
    localSrc: '/landing-media-fast/digital-passport.webp',
    publishedUrl: 'https://storage.googleapis.com/idogs-app.firebasestorage.app/landing-media/digital-passport/published/bc56f60a-f899-46c8-82c6-415c2c12dd37.jpg',
  },
}

export default function LandingPage() {
  const promotionDateActive = usePlusPromotion()
  // Launch campaign (1 year of Plus free, 100 places): the single headline offer while
  // it runs; the A$0 subscription promotion stays available in Pricing.
  const offerStatus = useOfferStatus()
  const launchActive = Boolean(offerStatus?.launch.active)
  const promotionActive = promotionDateActive && !offerStatus?.promotionSuperseded
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
              <a href="#howitworks">How it works</a>
              <a href="#for-owners">Dog Owners</a>
              <a href="#for-breeders">Breeders</a>
              <a href="#iphone">iPhone app</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
            </nav>
            <div className="nav-right">
              <Link className="nav-login" to="/login">Log In</Link>
              <Link className="btn nav-cta" to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link>
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
              <p className="eyebrow">For Australian dog owners and breeders</p>
              <h1>Everything your dog needs, all in one place.</h1>
              <p className="sub">Less paperwork. Less time searching. More time enjoying life with your dog.</p>
              <div className="cta-row">
                <Link className="btn btn-primary" to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link>
                <AppStoreLink className="btn btn-ghost">Download for iPhone</AppStoreLink>
              </div>
              <p className="hero-note">Free for up to {DOG_CAP_FREE} dogs · No card needed · On iPhone and the web</p>
              {launchActive && offerStatus ? (
                <p className="price-note voucher-note" data-testid="hero-launch-offer">
                  <strong>Free Gift Voucher:</strong> 1 year of iDogs Plus for 100 dog owners &amp; dog breeders, no card needed. <LaunchCountdownLine status={offerStatus} />{' '}
                  <Link to="/signup?next=%2Fapp%2Fbilling" onClick={() => trackLandingEvent('cta_voucher')} style={{ fontWeight: 700, textDecoration: 'underline', color: 'inherit' }}>Claim your Gift Voucher</Link>
                </p>
              ) : promotionActive ? (
                <p className="price-note">iDogs Plus A$0/month through 31 January 2027 · Then A$7/month.</p>
              ) : null}
              <p className="breeder-link"><a href="#for-breeders">Breeding dogs? Explore iDogs for Breeders →</a></p>
            </div>
            <div className="hero-visual" aria-label="iDogs product preview">
              <div className="hv-poster">
                <img
                  className="hv-shot"
                  src="/hero-idogs-cooper-1094.avif"
                  alt="iDogs Digital Passport and dog record preview"
                  width={1094}
                  height={1094}
                  fetchPriority="high"
                  loading="eager"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="features">
          <div className="wrap">
            <p className="kicker">Why iDogs</p>
            <h2>Less admin for you. A complete record for your dog.</h2>
            <div className="pillars pillars-3">
              <div className="pillar"><h4>Save time</h4><p>Photograph a vaccination certificate and iDogs Scan reads the key details for you to check and save. No retyping.</p></div>
              <div className="pillar"><h4>Stay organised</h4><p>Vaccinations, worming, health tests, documents and photos in one record for each dog, with email reminders before care is due.</p></div>
              <div className="pillar"><h4>Share easily</h4><p>Show a vet, groomer or boarding kennel what they need with your dog&apos;s QR Passport. Private documents stay private.</p></div>
            </div>
          </div>
        </section>

        <section className="block alt" id="howitworks">
          <div className="wrap">
            <p className="kicker">How iDogs works</p>
            <h2>Three simple steps.</h2>
            <div className="steps steps-3">
              <div className="step"><div className="n">1</div><h4>Create your free account</h4><p>Add your dog&apos;s name, breed, birthday and microchip number.</p></div>
              <div className="step"><div className="n">2</div><h4>Add records your way</h4><p>Scan a document with iDogs Scan or type the details in. Upload certificates and photos.</p></div>
              <div className="step"><div className="n">3</div><h4>Get reminders and share</h4><p>Get an email before care is due, and share the QR Passport when someone needs it.</p></div>
            </div>
          </div>
        </section>

        <section className="block" id="for-owners">
          <div className="wrap split">
            <div className="split-body">
              <p className="kicker">For dog owners</p>
              <h2>Stop searching for paperwork.</h2>
              <p className="lead">Keep your dog&apos;s whole history together, on your phone and on the web, so it&apos;s ready when you need it.</p>
              <ul className="checks">
                <li>Vaccination, worming and health test history</li>
                <li>Microchip papers, vet certificates and other documents</li>
                <li>Email reminders before vaccinations and worming are due</li>
                <li>A QR Passport that shows only a limited public view</li>
                <li>Your puppy&apos;s record, sent to you by your breeder at handover</li>
              </ul>
              <Link className="btn btn-path" onClick={() => trackLandingEvent('cta_owner')} to="/signup?role=owner">Start Free as a Dog Owner</Link>
            </div>
            <div className="split-media">
              <div className="frame-mobile"><div className="bar"><i></i><i></i><i></i></div>
                <img src="/landing-media-fast/digital-passport.webp" className="ph ph-mobile" alt="The limited public QR Passport view on a phone" loading="lazy" decoding="async" fetchPriority="low" />
              </div>
            </div>
          </div>
        </section>

        <section className="block alt" id="for-breeders">
          <div className="wrap split split-reverse">
            <div className="split-body">
              <p className="kicker">For breeders</p>
              <h2>From puppy to forever.</h2>
              <p className="lead">A simpler way to organise and share every puppy&apos;s story, from the first litter record to the new owner&apos;s handover.</p>
              <ul className="checks">
                <li>Your dogs, litters and puppies in one workspace</li>
                <li>Heat cycles, mating estimates and mating-due reminders</li>
                <li>A Puppy Showcase: one mobile-friendly link with photos of each puppy</li>
                <li>Send each puppy&apos;s record to its new owner</li>
                <li>iDogs Scan for vaccination and health test documents</li>
              </ul>
              <p className="mini-note">Litters and the Puppy Showcase are part of iDogs Plus: {LITTER_QUOTA_PLUS_ROLLING_12_MONTHS} litters per rolling 12 months included, extra litters A${EXTRA_LITTER_PRICE_AUD} each.</p>
              <Link className="btn btn-path" onClick={() => trackLandingEvent('cta_breeder')} to="/signup?role=breeder">Start Free as a Breeder</Link>
            </div>
            <div className="split-media">
              <div className="frame-mobile"><div className="bar"><i></i><i></i><i></i></div>
                <img src="/landing-media-fast/puppy-showcase.webp" className="ph ph-mobile" alt="A mobile-friendly Puppy Showcase" loading="lazy" decoding="async" fetchPriority="low" />
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="inside">
          <div className="wrap">
            <p className="kicker">A look inside</p>
            <h2>One organised profile for every dog.</h2>
            <div className="frame-desktop frame-wide"><div className="bar"><i></i><i></i><i></i></div>
              <img src="/landing-media-fast/dog-profile.webp" className="ph ph-desktop" alt="A dog profile in iDogs with its records and documents" loading="lazy" decoding="async" fetchPriority="low" />
            </div>
            <div className="shot-cap">A real iDogs screen: a dog&apos;s profile with its health records and documents.</div>
          </div>
        </section>

        <section className="iphone-band" id="iphone">
          <div className="wrap iphone-grid">
            <div>
              <p className="kicker kicker-light">iDogs for iPhone</p>
              <h2>Your dog&apos;s records, in your pocket.</h2>
              <p className="lead lead-light">Download the free iDogs app and sign in with the same account you use on the web. Requires iOS 15 or later.</p>
              <div className="store-row">
                <AppStoreLink className="btn btn-store" large>Download for iPhone</AppStoreLink>
                <p className="store-alt">Not on iPhone? iDogs works in any web browser. <Link to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link></p>
              </div>
            </div>
          </div>
        </section>

        <section className="block pricing-block" id="pricing">
          <div className="wrap">
            <p className="kicker">Simple pricing</p>
            <h2>Start free. Upgrade when you need more.</h2>
            <p className="lead">Free covers the essentials. iDogs Plus adds more dogs, more iDogs Scans and the breeder tools.</p>
            <div className="pricing-grid pricing-grid-2">
              <article className="pricing-card" data-testid="pricing-free">
                <p className="pricing-label">Free</p>
                <p className="pricing-price"><span>A$0</span><small>no card needed</small></p>
                <ul className="pricing-list">
                  <li>Up to {DOG_CAP_FREE} dogs</li>
                  <li>Health, vaccination and worming records</li>
                  <li>Documents and photos</li>
                  <li>QR Passport and email reminders</li>
                  <li>{SCAN_QUOTA_FREE_LIFETIME} iDogs Scans to try</li>
                </ul>
                <Link className="btn btn-path pricing-cta" to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link>
              </article>
              <article className="pricing-card pricing-card-main">
                <div className="pricing-card-head">
                  <div>
                    <p className="pricing-label">iDogs Plus</p>
                    {launchActive ? (
                      // A$7 is the real regular price (genuine reference price); the voucher makes the first year free.
                      <p className="pricing-price" data-testid="pricing-voucher-price"><del style={{ fontFamily: "'Fraunces','Georgia',serif", fontSize: 30, fontWeight: 600, lineHeight: 1, color: 'var(--ink-soft)', opacity: 0.75, marginRight: 6, textDecorationThickness: 2 }}>{`A$${PLUS_MONTHLY_PRICE_AUD}`}</del><span>A$0</span><small>/month for 12 months with the Gift Voucher</small></p>
                    ) : !promotionActive && <p className="pricing-price"><span>{`A$${PLUS_MONTHLY_PRICE_AUD}`}</span><small>/month including GST</small></p>}
                  </div>
                  <span className="pricing-badge">For more dogs and breeding</span>
                </div>
                {launchActive && offerStatus && (
                  <div data-testid="pricing-launch-offer" className="offer-box">
                    <p style={{ fontWeight: 700, margin: 0 }}>Free Gift Voucher: 1 year of iDogs Plus for 100 dog owners &amp; dog breeders, no card needed.</p>
                    <p style={{ fontSize: 13, margin: '4px 0 0' }}><LaunchCountdownLine status={offerStatus} /> · add your first dog, then claim. Nothing renews.</p>
                    <p style={{ fontSize: 13, margin: '4px 0 0' }}>For accounts that have added a dog and don&apos;t have a paid Plus plan. Limited to 100 places; claim by 31 December 2026 (Adelaide time). After the voucher year, Plus is A${PLUS_MONTHLY_PRICE_AUD}/month including GST.</p>
                  </div>
                )}
                {promotionActive && !launchActive && <PlusPromotion />}
                <p className="pricing-copy">Organise your dogs and breeding records in one connected workspace.</p>
                <ul className="pricing-list">
                  <li>Everything in Free</li>
                  <li>Up to {DOG_CAP_PLUS} dogs</li>
                  <li>{SCAN_QUOTA_PLUS_MONTHLY} iDogs Scans every month</li>
                  <li>Breeder tools: litters, puppies and Puppy Showcase</li>
                  <li>{LITTER_QUOTA_PLUS_ROLLING_12_MONTHS} litters per rolling 12 months included · {`extra litters A$${EXTRA_LITTER_PRICE_AUD} each`}</li>
                  <li>Optional SMS reminders: +A$3/month for 20 SMS credits, reset each billing month</li>
                </ul>
                {launchActive ? (
                  <>
                    <Link className="btn btn-primary pricing-cta" to="/signup?next=%2Fapp%2Fbilling" onClick={() => trackLandingEvent('cta_voucher')}>Claim your Gift Voucher — no card needed</Link>
                    {promotionActive && (
                      // The A$0 subscription offer stays available with its full
                      // terms, shown as the secondary choice under the voucher CTA.
                      <div style={{ marginTop: 16 }}>
                        <p style={{ fontSize: 13, margin: '0 0 8px' }}>
                          Prefer a monthly subscription? <Link to="/signup?next=%2Fapp%2Fbilling" style={{ textDecoration: 'underline', color: 'inherit' }}>Get Plus for A$0/month until 31 January 2027</Link>, then A$7/month.
                        </p>
                        <div style={{ fontSize: 12, opacity: 0.9 }}><PlusPromotion /></div>
                      </div>
                    )}
                  </>
                ) : (
                  <Link className="btn btn-primary pricing-cta" to={promotionActive ? '/signup?next=%2Fapp%2Fbilling' : '/signup'} onClick={() => trackLandingEvent('cta_get_started')}>{promotionActive ? 'Get Plus for A$0' : 'Get Started Free'}</Link>
                )}
              </article>
            </div>
            <p className="pricing-footnote">All paid prices are in AUD and include GST. Plus is managed on idogs.com.au.</p>
          </div>
        </section>

        <section className="block alt" id="privacy">
          <div className="wrap">
            <p className="kicker">Privacy and trust</p>
            <h2>Your dog&apos;s records stay yours.</h2>
            <div className="cards4">
              <div className="pillar"><h4>Private by default</h4><p>Your records and documents are visible only to you.</p></div>
              <div className="pillar"><h4>A limited QR view</h4><p>The QR Passport shows a limited public view, never your private documents.</p></div>
              <div className="pillar"><h4>Ads only with consent</h4><p>Ad measurement runs only if you opt in. Data is stored securely in the Asia-Pacific region.</p></div>
              <div className="pillar"><h4>Australian-owned</h4><p>Built in Adelaide for Australian dog owners and breeders. Delete your account at any time.</p></div>
            </div>
            <p className="mini-note"><Link to="/privacy">Read the Privacy Policy</Link> · <Link to="/terms">Read the Terms of Use</Link></p>
          </div>
        </section>

        <section className="block" id="faq">
          <div className="wrap faq-wrap">
            <p className="kicker">FAQ</p>
            <h2>Questions, answered.</h2>
            <div className="faq">
              <details open><summary>Is iDogs really free?</summary><p>Yes. The Free plan covers up to {DOG_CAP_FREE} dogs with health records, documents, the QR Passport and email reminders. No card needed.</p></details>
              <details><summary>What does iDogs Plus add?</summary><p>Up to {DOG_CAP_PLUS} dogs, {SCAN_QUOTA_PLUS_MONTHLY} iDogs Scans every month, and the breeder tools: litters, puppies and the Puppy Showcase.</p></details>
              <details><summary>Is there an app?</summary><p>Yes. iDogs is free on the App Store for iPhone (iOS 15 or later). On Android or a computer, use iDogs in your web browser with the same account.</p></details>
              <details><summary>Who can see my dog&apos;s QR Passport?</summary><p>Anyone with the QR code or link sees a limited public view. Your documents and private records stay private.</p></details>
              <details><summary>I&apos;m a breeder. Can I pass records to a puppy&apos;s new owner?</summary><p>Yes. Send the puppy to the new owner&apos;s email from iDogs and they can claim its record in their own account.</p></details>
              <details><summary>Who can use iDogs?</summary><p>You must be at least 16 to create an account. If you are under 18, you need permission from a parent or guardian, and paid plans are for adults aged 18 and over. See the <Link to="/terms">Terms of Use</Link>.</p></details>
              <details><summary>Where is my data stored?</summary><p>Securely in the Asia-Pacific region. See the <Link to="/privacy">Privacy Policy</Link> for details.</p></details>
            </div>
          </div>
        </section>

        <section className="final">
          <div className="wrap">
            <h2>Get your dog&apos;s records sorted today.</h2>
            <p>Free for up to {DOG_CAP_FREE} dogs. No card needed.</p>
            <div className="cta-row cta-center">
              <Link className="btn btn-primary" to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link>
              <AppStoreLink className="btn btn-ghost">Download for iPhone</AppStoreLink>
            </div>
          </div>
        </section>
        </main>

        <footer>
          <div className="wrap">
            <div className="foot-top">
              <div className="foot-brand">
                <img src="/03_idogs_reversed_white_transparent.png" alt="iDogs" style={{ width: 125, height: 'auto' }} />
                <div style={{ maxWidth: '34ch', marginTop: 12, color: 'var(--on-forest-soft)' }}>Everything your dog needs, all in one place.</div>
              </div>
              <div className="foot-cols">
                <div className="foot-col">
                  <h5>Product</h5>
                  <a href="#howitworks">How it works</a>
                  <a href="#for-owners">Dog Owners</a>
                  <a href="#for-breeders">Breeders</a>
                  <a href="#iphone">iPhone app</a>
                  <a href="#pricing">Pricing</a>
                </div>
                <div className="foot-col">
                  <h5>Account</h5>
                  <Link to="/login">Log In</Link>
                  <Link to="/signup">Get Started Free</Link>
                </div>
                <div className="foot-col">
                  <h5>Legal</h5>
                  <Link to="/privacy">Privacy Policy</Link>
                  <Link to="/terms">Terms of Use</Link>
                  <a href="mailto:hello@idogs.com.au">Contact: hello@idogs.com.au</a>
                </div>
              </div>
            </div>
            {/* Legal wording mirrors Terms of Use s.1 and s.7 (operator and trademark owner). Not yet reviewed by a solicitor: see docs/growth-v1/HANDOFF.md. */}
            <p className="foot-legal">iDogs provides record-management tools and does not constitute legal or regulatory advice. Breeders remain responsible for meeting applicable state, local council and registry requirements. <em>(Disclaimer pending legal review.)</em></p>
            <p className="foot-copy">iDogs is operated by iziPaws Pty Ltd (ABN 42 693 563 745), Adelaide, South Australia. The iDogs trademark is owned by NN Global Pty Ltd as trustee for NN Investment Trust.</p>
          </div>
        </footer>

        <div className="sticky-cta">
          <Link className="btn btn-primary" to="/signup" onClick={() => trackLandingEvent('cta_get_started')}>Get Started Free</Link>
          <AppStoreLink className="btn btn-store-icon" iconOnly>Download for iPhone</AppStoreLink>
        </div>
      </div>

      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} />}
    </div>
  )
}

// ── APP STORE LINK ───────────────────────────────────────────────
// The only place the iDogs App Store URL lives. Counted anonymously on click.
// Apple's marketing rules require its own badge artwork (never recreated), at
// least 40px high with clear space of a quarter of its height. Until the
// official artwork is supplied (APP_STORE_BADGE_SRC), this renders a plain
// "Download for iPhone" button that is not an Apple mark.
const APP_STORE_URL = 'https://apps.apple.com/au/app/idogs/id6823094602'
const APP_STORE_BADGE_SRC: string | null = null

function AppStoreLink({ className, children, large = false, iconOnly = false }: { className: string; children: ReactNode; large?: boolean; iconOnly?: boolean }) {
  const onClick = () => trackLandingEvent('app_store')
  if (APP_STORE_BADGE_SRC && large) {
    return (
      <a className="store-badge-link" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        <img src={APP_STORE_BADGE_SRC} alt="Download on the App Store" style={{ height: 48, width: 'auto', display: 'block' }} />
      </a>
    )
  }
  return (
    <a className={className} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={onClick} aria-label={iconOnly ? 'Download iDogs for iPhone on the App Store' : undefined}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: iconOnly ? 0 : 10, flex: 'none' }}><rect x="6" y="2" width="12" height="20" rx="2.5"></rect><path d="M11 18h2"></path></svg>
      {iconOnly ? null : large ? <span className="store-text"><small>Free on the App Store</small><strong>{children}</strong></span> : children}
    </a>
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
        <a href="#howitworks" onClick={onClose}>How it works</a>
        <a href="#for-owners" onClick={onClose}>Dog Owners</a>
        <a href="#for-breeders" onClick={onClose}>Breeders</a>
        <a href="#iphone" onClick={onClose}>iPhone app</a>
        <a href="#pricing" onClick={onClose}>Pricing</a>
        <a href="#faq" onClick={onClose}>FAQ</a>
        <Link to="/login" style={{ border: 'none' }} onClick={onClose}>Log In</Link>
        <Link className="btn btn-primary" to="/signup" onClick={() => { trackLandingEvent('cta_get_started'); onClose() }}>Get Started Free</Link>
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    let cancelled = false
    setMedia(null)
    setFailed(false)
    fetchPublishedLandingMedia(slotId).then(result => {
      if (!cancelled) setMedia(result)
    })
    return () => { cancelled = true }
  }, [slotId])

  const fastMedia = FAST_LANDING_MEDIA[slotId]
  if (failed && !fastMedia) return <>{fallback}</>

  const fillStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }

  if (media?.kind === 'video' && !failed) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <video
          ref={videoRef}
          className={className}
          style={fillStyle}
          src={media.url}
          aria-label={ariaLabel}
          autoPlay
          muted={muted}
          loop
          playsInline
          onError={() => setFailed(true)}
        />
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            v.muted = !v.muted
            setMuted(v.muted)
          }}
          aria-label={muted ? 'Unmute video' : 'Mute video'}
          style={{ position: 'absolute', bottom: 12, right: 12, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    )
  }

  const imageSrc = media?.kind === 'image' && !failed
    ? (fastMedia && media.url === fastMedia.publishedUrl ? fastMedia.localSrc : media.url)
    : fastMedia?.localSrc

  if (!imageSrc) return <>{fallback}</>

  return (
    <img
      className={className}
      style={fillStyle}
      src={imageSrc}
      alt={ariaLabel}
      loading="eager"
      decoding="async"
      fetchPriority="high"
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

  .lv2-page .price-note { margin:14px 0 0; color:var(--on-forest-soft); font-size:13px; font-weight:650; }
  .lv2-page .pricing-block { scroll-margin-top:76px; }
  .lv2-page .pricing-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr); gap:22px; margin-top:34px; align-items:stretch; }
  .lv2-page .pricing-card { border:1px solid var(--line); border-radius:var(--radius); padding:30px; background:#fffdf8; box-shadow:0 16px 38px rgba(20,35,31,.07); }
  .lv2-page .pricing-card-main { border-color:rgba(192,138,45,.6); }
  .lv2-page .pricing-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .lv2-page .pricing-label { margin:0 0 6px; color:var(--ink-soft); font-size:13px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
  .lv2-page .pricing-price { display:flex; align-items:baseline; gap:6px; margin:0 0 16px; }
  .lv2-page .pricing-price span { font-family:'Fraunces','Georgia',serif; font-size:46px; font-weight:650; line-height:1; color:var(--forest); }
  .lv2-page .pricing-price small { color:var(--ink-soft); font-size:14px; font-weight:650; }
  .lv2-page .pricing-badge { flex:0 0 auto; border-radius:999px; background:rgba(192,138,45,.14); color:var(--brass-lo); padding:7px 10px; font-size:12px; font-weight:800; }
  .lv2-page .pricing-copy { margin:0 0 18px; color:var(--ink-soft); max-width:56ch; }
  .lv2-page .pricing-list { list-style:none; padding:0; margin:0 0 24px; display:grid; gap:10px; }
  .lv2-page .pricing-list li { position:relative; padding-left:25px; }
  .lv2-page .pricing-list li::before { content:'✓'; position:absolute; left:0; color:var(--brass-lo); font-weight:900; }
  .lv2-page .pricing-cta { padding:11px 22px; }
  .lv2-page .pricing-card-addon h3 { margin:2px 0 14px; font-size:30px; }
  .lv2-page .sms-credit { display:flex; flex-direction:column; gap:2px; padding:16px 18px; border-radius:12px; background:var(--bone); border:1px solid var(--line); }
  .lv2-page .sms-credit strong { color:var(--forest); font-size:18px; }
  .lv2-page .sms-credit span { color:var(--ink-soft); font-size:13px; }
  .lv2-page .pricing-footnote { margin:18px 0 0; text-align:center; color:var(--ink-soft); font-size:13px; }
  @media (max-width: 760px) {
    .lv2-page .pricing-grid { grid-template-columns:1fr; }
    .lv2-page .pricing-card { padding:24px; }
    .lv2-page .pricing-card-head { flex-direction:column; gap:8px; }
    .lv2-page .pricing-price span { font-size:42px; }
  }
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
  .lv2-page .hv-shot { aspect-ratio:1/1; background:repeating-linear-gradient(135deg,#274a42 0 14px,#22443c 14px 28px); display:grid; place-items:center; text-align:center; color:var(--on-forest-soft); font-size:13px; padding:16px; }
  /* unused after hero simplification */
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
  .lv2-page .ph-mobile { aspect-ratio:9/19.5; overflow:hidden; }
  .lv2-page .frame-mobile img.ph-mobile, .lv2-page .frame-mobile video.ph-mobile { object-fit:cover!important; background:var(--bone-2); padding:0; }
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
  @media (max-height:480px) and (orientation:landscape){ .lv2-page .hero{padding:24px 0 32px;} .lv2-page .hero h1{font-size:30px;margin-bottom:10px;} .lv2-page .hero .sub{font-size:16px;margin-bottom:6px;} .lv2-page .eyebrow{margin-bottom:8px;} }
  @media (max-width:340px){ .lv2-page .hero{padding:32px 0 36px;} .lv2-page .hero h1{font-size:29px;margin-bottom:12px;} .lv2-page .hero .sub{font-size:16px;} .lv2-page .eyebrow{margin-bottom:10px;} .lv2-page .hero .incl{margin-bottom:18px;} }

  /* ── Growth V1 homepage (LP-03) ── */
  .lv2-page .hero-note { margin:14px 0 0; font-size:14px; color:var(--on-forest-soft); }
  .lv2-page .voucher-note { margin-top:20px; padding:14px 16px; border:1px solid rgba(217,165,69,.55); background:rgba(192,138,45,.14); border-radius:12px; color:var(--on-forest); font-size:14px; font-weight:500; max-width:560px; }
  .lv2-page .breeder-link { margin:20px 0 0; font-size:15px; }
  .lv2-page .breeder-link a { color:var(--on-forest); font-weight:700; text-underline-offset:3px; }
  .lv2-page .cta-center { justify-content:center; }
  .lv2-page .cards4 { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:20px; }
  .lv2-page .step p { margin:6px 0 0; font-size:14px; color:var(--ink-soft); }
  .lv2-page .split { display:flex; gap:48px; align-items:center; }
  .lv2-page .split-reverse { flex-direction:row-reverse; }
  .lv2-page .split-body { flex:1 1 0; min-width:0; }
  .lv2-page .split-media { flex:0 0 300px; }
  .lv2-page .split-media .frame-mobile { max-width:300px; }
  .lv2-page .checks { list-style:none; margin:22px 0; padding:0; display:grid; gap:12px; font-size:16px; }
  .lv2-page .checks li { position:relative; padding-left:28px; }
  .lv2-page .checks li::before { content:'✓'; position:absolute; left:0; color:var(--brass-lo); font-weight:900; }
  .lv2-page .mini-note { margin:0 0 22px; font-size:14px; color:var(--ink-soft); }
  .lv2-page .mini-note a { color:var(--forest); font-weight:600; }
  .lv2-page .frame-wide { max-width:980px; margin-top:24px; }
  .lv2-page .iphone-band { background:var(--forest-2); color:var(--on-forest); padding:72px 0; scroll-margin-top:80px; }
  .lv2-page .iphone-band h2 { font-size:clamp(28px,3.4vw,40px); margin:0 0 14px; max-width:24ch; }
  .lv2-page .kicker-light { color:var(--brass); }
  .lv2-page .lead-light { color:var(--on-forest-soft); }
  .lv2-page .store-row { display:flex; gap:18px 24px; align-items:center; flex-wrap:wrap; margin-top:24px; }
  .lv2-page .btn-store { background:#000; color:#fff; border:1px solid var(--on-forest-soft); border-radius:12px; padding:0 22px; min-height:56px; }
  .lv2-page .btn-store:hover { background:#111; }
  .lv2-page .store-text { display:flex; flex-direction:column; align-items:flex-start; line-height:1.15; text-align:left; }
  .lv2-page .store-text small { font-size:12px; font-weight:500; }
  .lv2-page .store-text strong { font-size:18px; font-weight:700; }
  .lv2-page .store-badge-link { display:inline-block; padding:12px; }
  .lv2-page .store-alt { margin:0; font-size:14px; color:var(--on-forest-soft); }
  .lv2-page .store-alt a { color:var(--on-forest); font-weight:700; }
  .lv2-page .pricing-grid-2 { grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr); }
  .lv2-page .offer-box { border:2px solid var(--brass); border-radius:12px; padding:12px 14px; margin:8px 0 14px; background:#fbf3df; }
  .lv2-page .faq-wrap { max-width:860px; }
  .lv2-page .faq { display:grid; gap:10px; margin-top:20px; }
  .lv2-page .faq details { background:#fffdf8; border:1px solid var(--line); border-radius:12px; padding:2px 20px; }
  .lv2-page .faq summary { cursor:pointer; list-style:none; font-weight:700; padding:12px 0; min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .lv2-page .faq summary::-webkit-details-marker { display:none; }
  .lv2-page .faq summary::after { content:'+'; font-size:22px; line-height:1; color:var(--brass-lo); }
  .lv2-page .faq details[open] summary::after { content:'–'; }
  .lv2-page .faq p { margin:0 0 16px; color:var(--ink-soft); }
  .lv2-page .faq a { color:var(--forest); font-weight:600; }
  @media (max-width:1100px){
    .lv2-page .nav-links{display:none;}
    .lv2-page .hamburger{display:inline-flex;}
  }
  @media (max-width:900px){
    .lv2-page .split, .lv2-page .split-reverse { flex-direction:column; align-items:stretch; gap:32px; }
    .lv2-page .split-media { flex:none; width:100%; max-width:300px; align-self:center; }
    .lv2-page .cards4 { grid-template-columns:1fr 1fr; }
    .lv2-page .pillars.pillars-3 { grid-template-columns:1fr; }
  }
  @media (max-width:760px){
    .lv2-page .pricing-grid-2 { grid-template-columns:1fr; }
  }
  @media (max-width:620px){
    .lv2-page .cards4 { grid-template-columns:1fr; }
    .lv2-page .cta-row .btn { flex:1 1 100%; }
    .lv2-page .iphone-band { padding:52px 0 52px; }
    .lv2-page .sticky-cta { display:flex; gap:10px; }
    .lv2-page .sticky-cta .btn-primary { flex:1 1 auto; width:auto; }
    .lv2-page .sticky-cta .btn-store-icon { flex:none; width:50px; padding:0; background:transparent; color:var(--on-forest); border:1.5px solid var(--on-forest-soft); }
  }
`
