import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { scheduleLandingBeacon } from '../lib/landingBeacon'
import { isMarketingWebsitePage, readMetaConsent, setMetaConsent, suspendMetaTracking, trackMarketingPage } from '../lib/metaPixel'

// Advertising privacy choices for the public marketing pages (/ and /signup).
//
// UX (Owner P0, 01 Nov 2026): a large fixed consent box covered the hero and
// the sticky "Start Free" bar on phones. The marketing pages now show only a
// compact "Ad privacy choices" pill that never overlaps any call to action:
// it measures the mobile sticky CTA bar at runtime and sits just above it.
// Tapping the pill opens an accessible dialog with Decline / Allow.
//
// Consent semantics are UNCHANGED: Meta Pixel stays off until the visitor
// explicitly chooses "Allow ad measurement" (see lib/metaPixel.ts — pixel()
// returns nothing without a stored 'granted' choice). No choice = no tracking.

const GAP = 8 // px between the pill and the sticky CTA bar / screen edge

/** Distance from the bottom of the viewport the pill must sit above, so it never covers a visible fixed/sticky CTA. */
export function pillBottomOffset(doc: Document = document, win: Window = window): number {
  let offset = 0
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.sticky-cta'))) {
    const style = win.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0 || rect.top >= win.innerHeight) continue
    offset = Math.max(offset, win.innerHeight - rect.top)
  }
  return Math.ceil(offset)
}

export default function MarketingMeasurement() {
  const { pathname, search } = useLocation()
  const [consent, setConsent] = useState(readMetaConsent)
  const [open, setOpen] = useState(false)
  const [bottom, setBottom] = useState(0)
  const pillRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => { scheduleLandingBeacon(search, pathname) }, [pathname, search])

  useEffect(() => {
    suspendMetaTracking()
    trackMarketingPage()
  }, [pathname, search, consent])

  const marketing = isMarketingWebsitePage()

  // Keep the pill above the sticky CTA bar as the layout / Safari toolbar changes.
  const measure = useCallback(() => setBottom(pillBottomOffset()), [])
  useLayoutEffect(() => {
    if (!marketing) return
    measure()
    const timer = window.setTimeout(measure, 300) // after fonts / late layout
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [marketing, pathname, measure])

  // Dialog: focus the first choice on open, close on Escape, return focus to the pill.
  useEffect(() => {
    if (!open) return
    dialogRef.current?.querySelector<HTMLButtonElement>('button[data-choice]')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!marketing) return null

  function close() {
    setOpen(false)
    window.setTimeout(() => pillRef.current?.focus(), 0)
  }
  function choose(value: 'granted' | 'denied') {
    setMetaConsent(value)
    setConsent(readMetaConsent())
    close()
  }

  const status = consent === 'granted' ? 'Ad measurement allowed' : consent === 'denied' ? 'Ad measurement declined' : 'Not set — off until you allow it'

  return <>
    {/* In-flow spacer: the last content on the page can always scroll clear of the pill. */}
    <div aria-hidden="true" data-testid="ad-privacy-spacer" style={{ height: 56 }} />
    {!open && <button
      ref={pillRef}
      type="button"
      className="idogs-ad-privacy-pill"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      style={{
        position: 'fixed',
        left: 'calc(12px + env(safe-area-inset-left, 0px))',
        bottom: bottom > 0 ? bottom + GAP : 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 60,
        maxWidth: 'calc(100vw - 24px)',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        background: '#fff',
        color: '#085041',
        border: '1px solid #c9d3cc',
        borderRadius: 999,
        boxShadow: '0 1px 6px #0001',
        cursor: 'pointer',
      }}
    >Ad privacy choices</button>}
    {open && <div
      data-testid="ad-privacy-backdrop"
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px))' }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-privacy-title"
        aria-describedby="ad-privacy-text"
        onClick={event => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflowY: 'auto', padding: 20, background: '#fff', color: '#183e32', border: '1px solid #ccc', borderRadius: 14, boxShadow: '0 4px 24px #0002' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <strong id="ad-privacy-title">Ad privacy choices</strong>
          <button type="button" aria-label="Close ad privacy choices" onClick={close} style={{ background: 'none', border: 0, fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#5c5a54' }}>×</button>
        </div>
        <p id="ad-privacy-text" style={{ fontSize: 14, lineHeight: 1.5, margin: '8px 0 12px' }}>Allow ad measurement to help make iDogs advertising more relevant to people interested in dogs and puppy updates. If you agree, Meta Pixel shares visits to our home and signup pages and successful registrations with Meta (Facebook), including browser, IP and cookie information. We do not send your form entries or dog records. This is optional: you can use iDogs either way and change your choice any time. <a href="/privacy">Privacy policy</a></p>
        <p role="status" style={{ fontSize: 12, color: '#5c5a54', margin: '0 0 14px' }}>Current choice: {status}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" data-choice="denied" className="btn btn-secondary" aria-pressed={consent === 'denied'} onClick={() => choose('denied')}>Decline</button>
          <button type="button" data-choice="granted" className="btn btn-primary" aria-pressed={consent === 'granted'} onClick={() => choose('granted')}>Allow ad measurement</button>
        </div>
      </section>
    </div>}
  </>
}
