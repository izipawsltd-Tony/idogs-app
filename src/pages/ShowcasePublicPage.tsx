import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatDate, getDogAge } from '../lib/utils'

interface PublicMediaItem { id: string; url: string }
interface PublicPuppy {
  id: string; name: string; sex: 'male' | 'female'; breed: string; colour: string | null; dateOfBirth: string
  availability: 'available' | 'reserved' | 'sold'; personality: string | null; readyToGoHomeDate: string | null
  priceCents?: number; depositCents?: number; photos: PublicMediaItem[]; videos: PublicMediaItem[]
}
interface PublicLitter { name: string; damName: string | null; sireName: string | null; actualBirthDate: string | null; readyToGoHomeDate: string | null }

const STATUS = {
  available: { label: 'Available', bg: '#E1F5EE', fg: '#085041' },
  reserved: { label: 'Reserved', bg: '#FDF3DC', fg: '#8A5B00' },
  sold: { label: 'Sold', bg: '#ECEBE7', fg: '#5C5A54' },
} as const
const money = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(cents / 100)

function Placeholder({ name }: { name: string }) {
  return <div aria-label={`${name} has no public photo`} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg,#E1F5EE,#FDF3DC)' }}><img src="/logo.png" alt="" style={{ width: '55%', maxHeight: 56, objectFit: 'contain', opacity: .72 }} /></div>
}

export default function ShowcasePublicPage() {
  const { token } = useParams<{ token: string }>()
  const [litter, setLitter] = useState<PublicLitter | null>(null)
  const [puppies, setPuppies] = useState<PublicPuppy[]>([])
  const [selected, setSelected] = useState<PublicPuppy | null>(null)
  const [enquiryPuppy, setEnquiryPuppy] = useState('')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const enquiryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    let cancelled = false
    fetch(`/api/showcase-public?token=${encodeURIComponent(token)}`).then(async response => {
      if (!response.ok) throw new Error('not-found')
      const data = await response.json()
      if (!cancelled) { setLitter(data.litter); setPuppies(data.puppies) }
    }).catch(() => { if (!cancelled) setNotFound(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected])

  function enquire(puppy: PublicPuppy) {
    setSelected(null); setEnquiryPuppy(puppy.id)
    requestAnimationFrame(() => enquiryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  if (loading) return <main style={center}><div className="spinner" aria-label="Loading Showcase" /></main>
  if (notFound || !litter) return <main style={center}><div style={{ textAlign: 'center', maxWidth: 420 }}><img src="/logo.png" alt="iDogs" style={{ width: 150, marginBottom: 28 }} /><h1 style={{ fontSize: 24 }}>This link isn&apos;t available</h1><p style={{ color: 'var(--mid)' }}>It may have been turned off, replaced with a new link, or has expired.</p><Link className="btn btn-primary" to="/">Go to iDogs</Link></div></main>

  return <main style={{ minHeight: '100vh', background: '#F5F0E8', color: '#1A1917' }}>
    <header style={{ background: 'linear-gradient(135deg,#063D32,#0D6B58)', color: 'white', padding: '24px 20px 64px' }}>
      <div style={{ maxWidth: 1100, margin: 'auto' }}>
        <Link to="/" aria-label="iDogs home"><img src="/logo.png" alt="iDogs" style={{ width: 132, filter: 'brightness(0) invert(1)', marginBottom: 30 }} /></Link>
        <div style={{ color: '#BCE7DC', textTransform: 'uppercase', letterSpacing: 2, fontSize: 12, fontWeight: 700 }}>Litter Showcase</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(30px,6vw,52px)', margin: '8px 0 14px', overflowWrap: 'break-word' }}>{litter.name}</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', color: 'rgba(255,255,255,.82)', fontSize: 14 }}>
          {litter.damName && <span>Dam: {litter.damName}</span>}{litter.sireName && <span>Sire: {litter.sireName}</span>}
          {litter.actualBirthDate && <span>Born: {formatDate(litter.actualBirthDate)}</span>}
          {litter.readyToGoHomeDate && <span>Ready for new homes: {formatDate(litter.readyToGoHomeDate)}</span>}
        </div>
      </div>
    </header>

    <section aria-label="Puppies" style={{ maxWidth: 1100, margin: '-34px auto 0', padding: '0 16px 48px' }}>
      {puppies.length === 0 ? <div style={panel}>No puppies are currently shown from this litter.</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
          {puppies.map(puppy => <PuppyCard key={puppy.id} puppy={puppy} onOpen={() => setSelected(puppy)} onEnquire={() => enquire(puppy)} />)}
        </div>}
      {token && <div ref={enquiryRef}><EnquiryForm token={token} puppies={puppies} selectedPuppy={enquiryPuppy} onSelectedPuppy={setEnquiryPuppy} /></div>}
    </section>

    {selected && <PuppyDialog puppy={selected} onClose={() => setSelected(null)} onEnquire={() => enquire(selected)} />}
  </main>
}

function PuppyCard({ puppy, onOpen, onEnquire }: { puppy: PublicPuppy; onOpen: () => void; onEnquire: () => void }) {
  const status = STATUS[puppy.availability]
  return <article style={{ ...panel, padding: 0, overflow: 'hidden', textAlign: 'left' }}>
    <button onClick={onOpen} aria-label={`View ${puppy.name}'s profile`} style={{ width: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'block' }}>
      <div style={{ aspectRatio: '4/3', overflow: 'hidden' }}>{puppy.photos[0] ? <img src={puppy.photos[0].url} alt={`${puppy.name} cover photo`} loading="lazy" style={cover} /> : <Placeholder name={puppy.name} />}</div>
      <div style={{ padding: '12px 14px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0, fontSize: 18 }}>{puppy.name}</h2><span style={{ ...badge, background: status.bg, color: status.fg }}>{status.label}</span></div>
        <p style={{ color: 'var(--mid)', fontSize: 13, margin: '4px 0 0' }}>{puppy.sex === 'female' ? 'Female' : 'Male'} · {getDogAge(puppy.dateOfBirth)}</p>
        {(puppy.priceCents !== undefined || puppy.depositCents !== undefined) && <p style={{ fontWeight: 700, color: '#085041', fontSize: 14, margin: '6px 0 0' }}>{puppy.priceCents !== undefined && `Price ${money(puppy.priceCents)}`}{puppy.priceCents !== undefined && puppy.depositCents !== undefined && ' · '}{puppy.depositCents !== undefined && `Deposit ${money(puppy.depositCents)}`}</p>}
      </div>
    </button>
    {/* Staging QA fix: the old "Enquire about {name}" label, combined
        with .btn white-space: nowrap (index.css), overflowed/clipped on
        narrow mobile cards for longer puppy names. The name is already
        shown directly above, so the visible label is now short and fixed
        regardless of name length; aria-label keeps the full descriptive
        name for assistive tech. minHeight: 44 meets the mobile touch
        target guideline. */}
    <div style={{ padding: '8px 14px 14px' }}><button className="btn btn-primary" onClick={onEnquire} aria-label={`Enquire about ${puppy.name}`} style={{ width: '100%', minHeight: 44, padding: '10px 20px', boxSizing: 'border-box' }}>Enquire</button></div>
  </article>
}

// Image-first gallery (staging fix: "current cards/modal waste too much
// white space, and enlarged photos are cropped"). Layout is CSS-driven
// (.showcase-gallery* rules in index.css, row on desktop/column on
// mobile via @media) — only the enlarged-image containment itself
// (`contain`, defined alongside `cover` below) is inline, since it must
// hold regardless of breakpoint. Focus trap / Escape-to-close logic is
// UNCHANGED from the previous implementation, just extended with
// ArrowLeft/ArrowRight for photo navigation in the same listener.
function PuppyDialog({ puppy, onClose, onEnquire }: { puppy: PublicPuppy; onClose: () => void; onEnquire: () => void }) {
  const media = [...puppy.photos.map(x => ({ ...x, kind: 'photo' as const })), ...puppy.videos.map(x => ({ ...x, kind: 'video' as const }))]
  const [active, setActive] = useState(0)
  const item = media[active]
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  function goTo(index: number) { setActive(((index % media.length) + media.length) % media.length) }
  function goPrev() { goTo(active - 1) }
  function goNext() { goTo(active + 1) }

  // Background must not scroll while the gallery is open — restores
  // whatever the page's own overflow value was (rather than assuming
  // 'visible') so this never fights another component's own setting.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    closeRef.current?.focus()
    const dialog = dialogRef.current
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (media.length > 1 && event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); return }
      if (media.length > 1 && event.key === 'ArrowRight') { event.preventDefault(); goNext(); return }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); openerRef.current?.focus() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, active, media.length])

  const status = STATUS[puppy.availability]

  return <div role="presentation" className="showcase-gallery-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="puppy-title" className="showcase-gallery">
      <div className="showcase-gallery-image-area">
        <button ref={closeRef} onClick={onClose} aria-label="Close puppy profile" style={{ position: 'absolute', right: 12, top: 12, zIndex: 3, border: 0, borderRadius: 99, width: 38, height: 38, fontSize: 20, cursor: 'pointer', background: 'rgba(255,255,255,.92)', color: '#1A1917', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        <div className="showcase-gallery-main">
          {!item ? <Placeholder name={puppy.name} /> : item.kind === 'photo'
            ? <img src={item.url} alt={`${puppy.name} photo ${active + 1} of ${media.length}`} style={contain} />
            : <video src={item.url} controls aria-label={`${puppy.name} video ${active + 1} of ${media.length}`} style={contain} />}
          {media.length > 1 && <>
            <button onClick={goPrev} aria-label="Previous photo" style={navArrow('left')}>‹</button>
            <button onClick={goNext} aria-label="Next photo" style={navArrow('right')}>›</button>
          </>}
        </div>
        {media.length > 1 && <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: 10, background: '#0b0b0b', flex: '0 0 auto' }}>{media.map((m, i) => <button key={`${m.kind}-${m.id}`} onClick={() => goTo(i)} aria-label={`Show ${m.kind} ${i + 1}`} aria-current={i === active} style={{ border: i === active ? '2px solid #fff' : '1px solid rgba(255,255,255,.35)', borderRadius: 6, padding: 0, minWidth: 56, height: 44, overflow: 'hidden', flexShrink: 0, opacity: i === active ? 1 : .65 }}>{m.kind === 'photo' ? <img src={m.url} alt="" loading="lazy" style={cover} /> : <video src={m.url} style={cover} />}</button>)}</div>}
      </div>
      <div className="showcase-gallery-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><h2 id="puppy-title" style={{ margin: 0, fontSize: 20 }}>{puppy.name}</h2><span style={{ ...badge, background: status.bg, color: status.fg }}>{status.label}</span></div>
        <p style={{ color: 'var(--mid)', fontSize: 14, margin: '8px 0 0' }}>{puppy.sex === 'female' ? 'Female' : 'Male'} · {puppy.colour || puppy.breed} · Born {formatDate(puppy.dateOfBirth)}</p>
        {puppy.readyToGoHomeDate && <p style={{ fontSize: 14, margin: '8px 0 0' }}><strong>Ready for new home:</strong> {formatDate(puppy.readyToGoHomeDate)}</p>}
        {puppy.personality && <p style={{ fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>{puppy.personality}</p>}
        {(puppy.priceCents !== undefined || puppy.depositCents !== undefined) && <p style={{ color: '#085041', fontWeight: 700, margin: '10px 0 0' }}>{puppy.priceCents !== undefined && `Price ${money(puppy.priceCents)}`}{puppy.priceCents !== undefined && puppy.depositCents !== undefined && ' · '}{puppy.depositCents !== undefined && `Deposit ${money(puppy.depositCents)}`}</p>}
        <button className="btn btn-primary" onClick={onEnquire} style={{ width: '100%', marginTop: 16 }}>Enquire about {puppy.name}</button>
      </div>
    </section>
  </div>
}

function EnquiryForm({ token, puppies, selectedPuppy, onSelectedPuppy }: { token: string; puppies: PublicPuppy[]; selectedPuppy: string; onSelectedPuppy: (id: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '', consent: false, website: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  // Set from the server's own `notified` field (api/create-showcase-
  // enquiry.js) — never assumed. false covers both "no email attempt was
  // made" (e.g. RESEND_API_KEY not configured for this deployment) and
  // "an attempt was made but failed" — from this visitor's point of
  // view both are the same accurate statement: their enquiry IS saved,
  // but whether the breeder has actually seen an email about it is not
  // something this page can promise.
  const [notified, setNotified] = useState(false)
  const [sentFor, setSentFor] = useState<string | null>(null)
  useEffect(() => {
    if (state === 'sent' && selectedPuppy !== sentFor) {
      setState('idle'); setError(''); setNotified(false)
      setForm({ name: '', email: '', phone: '', message: '', consent: false, website: '' })
    }
  }, [selectedPuppy, state, sentFor])
  async function submit(e: FormEvent) {
    e.preventDefault(); if (state === 'sending') return; setState('sending'); setError('')
    try {
      const response = await fetch('/api/create-showcase-enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, puppyRef: selectedPuppy || undefined, ...form }) })
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Could not send your enquiry')
      setNotified(data.notified === true)
      setSentFor(selectedPuppy)
      setState('sent')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your enquiry'); setState('error') }
  }
  if (state === 'sent' && sentFor === selectedPuppy) return <div style={{ ...panel, marginTop: 30 }} role="status">
    {notified
      ? <><h2>Enquiry sent successfully</h2><p>The breeder has been notified.</p></>
      : <><h2>Enquiry submitted successfully</h2><p>The breeder can view it in iDogs.</p></>}
  </div>
  return <form onSubmit={submit} style={{ ...panel, marginTop: 30, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', textAlign: 'left' }}><h2>Enquire about this litter</h2>
    <label className="form-group"><span className="form-label">Interested puppy</span><select className="form-select" value={selectedPuppy} onChange={e => onSelectedPuppy(e.target.value)}><option value="">General enquiry</option>{puppies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="form-group"><span className="form-label">Name</span><input className="form-input" required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}><label className="form-group"><span className="form-label">Your email <span style={{ fontWeight: 400, color: 'var(--mid)' }}>(so the breeder can contact you back)</span></span><input className="form-input" type="email" maxLength={200} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label className="form-group"><span className="form-label">Phone</span><input className="form-input" type="tel" maxLength={200} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label></div>
    <label className="form-group"><span className="form-label">Message</span><textarea className="form-input" required rows={4} maxLength={3000} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} /></label>
    <div aria-hidden="true" style={{ position: 'absolute', left: -9999 }}><input name="website" tabIndex={-1} value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} /></div>
    <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '12px 0' }}><input type="checkbox" required checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} />I consent to the breeder contacting me.</label>
    {state === 'error' && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}<button className="btn btn-primary" disabled={state === 'sending' || !form.consent} style={{ width: '100%' }}>{state === 'sending' ? 'Sending…' : selectedPuppy ? `Enquire about ${puppies.find(p => p.id === selectedPuppy)?.name || 'this puppy'}` : 'Send enquiry'}</button>
  </form>
}

const center = { minHeight: '100vh', background: '#F5F0E8', display: 'grid', placeItems: 'center', padding: 24 }
const panel = { background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 8px 28px rgba(28,45,38,.09)', textAlign: 'center' as const }
const cover = { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' }
// Gallery-viewer sizing: width/height 'auto' with only a max-* ceiling
// means the browser scales the image DOWN to fit when it's larger than
// the available box, but never scales a small image UP past its own
// natural size — objectFit is kept explicitly ('contain') as a
// belt-and-braces guarantee against cropping even if this element's box
// model ever changes, without conflicting with that no-upscale behavior.
const contain = { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' as const, display: 'block', margin: 'auto' }
const badge = { fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 99, whiteSpace: 'nowrap' as const, alignSelf: 'flex-start' }
function navArrow(side: 'left' | 'right') {
  return {
    position: 'absolute' as const, [side]: 10, top: '50%', transform: 'translateY(-50%)',
    width: 44, height: 44, borderRadius: 99, border: 0, cursor: 'pointer',
    background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 26, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
  }
}
