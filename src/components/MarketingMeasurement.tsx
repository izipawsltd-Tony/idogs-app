import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isMarketingWebsitePage, readMetaConsent, setMetaConsent, suspendMetaTracking, trackMarketingPage } from '../lib/metaPixel'

export default function MarketingMeasurement() {
  const { pathname, search } = useLocation()
  const [consent, setConsent] = useState(readMetaConsent)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    suspendMetaTracking()
    trackMarketingPage()
  }, [pathname, search, consent])
  if (!isMarketingWebsitePage()) return null
  function choose(value: 'granted' | 'denied') {
    setMetaConsent(value)
    setConsent(readMetaConsent())
    setEditing(false)
  }
  if (consent && !editing) return <button type="button" onClick={() => setEditing(true)} style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 1000, fontSize: 12, padding: '8px 12px', background: '#fff', color: '#085041', border: '1px solid #ccc', borderRadius: 8 }}>Ad privacy choices</button>
  return <section aria-label="Advertising privacy choices" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, maxWidth: 560, zIndex: 1000, padding: 20, background: '#fff', color: '#183e32', border: '1px solid #ccc', borderRadius: 14, boxShadow: '0 4px 24px #0002' }}>
    <strong>Discover more of what matters to you and your dog</strong>
    <p style={{ fontSize: 14, lineHeight: 1.5, margin: '8px 0 16px' }}>Allow ad measurement to help make iDogs advertising more relevant to people interested in dogs and puppy updates. If you agree, Meta Pixel shares visits to our home and signup pages and successful registrations with Meta (Facebook), including browser, IP and cookie information. We do not send your form entries or dog records. This is optional: you can use iDogs either way and change your choice any time. <a href="/privacy">Privacy policy</a></p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <button type="button" className="btn btn-secondary" onClick={() => choose('denied')}>Decline</button>
      <button type="button" className="btn btn-primary" onClick={() => choose('granted')}>Allow ad measurement</button>
    </div>
  </section>
}
