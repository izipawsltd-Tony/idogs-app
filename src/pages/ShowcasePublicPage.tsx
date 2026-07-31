import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getDogAge } from '../lib/utils'

// Mirrors the exact allowlisted shape api/showcase-public.js returns —
// deliberately its OWN minimal type here, not the full `Dog`/`Litter`
// types, so this file can never accidentally reference a field the
// public endpoint doesn't actually send (private/internal dog fields
// simply do not exist on this shape at all — a typo reaching for one
// would be a compile error, not a silent `undefined`).
//
// Codex fix-round: `id` is an OPAQUE reference (opaquePuppyRef()), never
// the real Firestore dogId — see api/_lib/showcase-media-access.js.
// `photos`/`videos` are freshly-signed, short-lived URLs for ONLY the
// media this puppy's Showcase entry explicitly published — never the
// full private gallery, never the dog's own profile-photo field (removed entirely; a
// puppy's public "photo" is only ever something the breeder explicitly
// chose to publish).
interface PublicMediaItem {
  id: string
  url: string
}
interface PublicPuppy {
  id: string
  name: string
  sex: 'male' | 'female'
  breed: string
  colour: string | null
  dateOfBirth: string
  availability: 'available' | 'on_hold' | 'reserved' | 'unavailable'
  photos: PublicMediaItem[]
  videos: PublicMediaItem[]
}
interface PublicLitter {
  name: string
  damName: string | null
  sireName: string | null
  actualBirthDate: string | null
}

const AVAILABILITY_LABEL: Record<PublicPuppy['availability'], string> = {
  available: 'Available',
  on_hold: 'On Hold',
  reserved: 'Reserved',
  unavailable: 'Not Available',
}
const AVAILABILITY_COLOR: Record<PublicPuppy['availability'], { bg: string; fg: string }> = {
  available: { bg: '#E1F5EE', fg: 'var(--brand-600)' },
  on_hold: { bg: '#FDF3DC', fg: '#C8971F' },
  reserved: { bg: '#F0F0EE', fg: 'var(--mid)' },
  unavailable: { bg: '#F0F0EE', fg: 'var(--light)' },
}

export default function ShowcasePublicPage() {
  const { token } = useParams<{ token: string }>()
  const [litter, setLitter] = useState<PublicLitter | null>(null)
  const [puppies, setPuppies] = useState<PublicPuppy[]>([])
  const [loading, setLoading] = useState(true)
  // Deliberately a single generic "not found" state — the backend
  // itself never distinguishes wrong/disabled/expired/revoked (see
  // api/showcase-public.js), so this page must not invent a
  // distinction on the client that the server was careful not to leak.
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    let cancelled = false
    async function load() {
      try {
        const response = await fetch(`/api/showcase-public?token=${encodeURIComponent(token!)}`)
        if (cancelled) return
        if (!response.ok) { setNotFound(true); return }
        const data = await response.json()
        if (cancelled) return
        setLitter(data.litter as PublicLitter)
        setPuppies(data.puppies as PublicPuppy[])
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🐾</div>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    </div>
  )

  if (notFound || !litter) return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🐾</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: '#1A1917', marginBottom: 8 }}>This link isn&apos;t available</div>
        <div style={{ fontSize: 14, color: '#9A9891', marginBottom: 20 }}>It may have been turned off, replaced with a new link, or has expired.</div>
        <Link to="/" style={{ background: 'var(--brand-600)', color: '#fff', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Go to iDogs →</Link>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8' }}>
      {/* Hero header */}
      <div style={{ background: 'linear-gradient(160deg, var(--brand-900) 0%, var(--brand-600) 100%)', padding: '28px 20px 40px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', marginBottom: 20 }}>
            <span style={{ fontSize: 18 }}>🐾</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>iDogs</span>
          </Link>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{litter.name}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {litter.damName && <span>Dam: {litter.damName}</span>}
            {litter.sireName && <span>Sire: {litter.sireName}</span>}
            {litter.actualBirthDate && <span>Born {litter.actualBirthDate}</span>}
          </div>
        </div>
      </div>

      {/* Puppy list */}
      <div style={{ maxWidth: 480, margin: '-24px auto 0', padding: '0 16px 40px' }}>
        {puppies.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--light)', fontSize: 14 }}>
            No puppies are currently shown from this litter.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {puppies.map(puppy => {
              const photo = puppy.photos?.[0]?.url || null
              const color = AVAILABILITY_COLOR[puppy.availability]
              return (
                <div key={puppy.id} style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', gap: 12, padding: 14 }}>
                    <div style={{
                      width: 72, height: 72, borderRadius: 12, flexShrink: 0,
                      background: photo ? `url(${photo}) center/cover` : 'var(--brand-50)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                    }}>
                      {!photo && '🐶'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)' }}>{puppy.name}</span>
                        <span style={{ fontSize: 13 }}>{puppy.sex === 'female' ? '♀' : '♂'}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 6 }}>
                        {puppy.breed}{puppy.colour ? ` · ${puppy.colour}` : ''} · {getDogAge(puppy.dateOfBirth)}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: color.bg, color: color.fg }}>
                        {AVAILABILITY_LABEL[puppy.availability]}
                      </span>
                    </div>
                  </div>
                  {puppy.photos && puppy.photos.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, padding: '0 14px 14px', overflowX: 'auto' }}>
                      {puppy.photos.map((item, i) => (
                        <img key={item.id} src={item.url} alt={`${puppy.name} photo ${i + 1}`} style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      ))}
                    </div>
                  )}
                  {puppy.videos && puppy.videos.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, padding: '0 14px 14px', overflowX: 'auto' }}>
                      {puppy.videos.map((item, i) => (
                        <video key={item.id} src={item.url} controls style={{ width: 120, height: 80, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} aria-label={`${puppy.name} video ${i + 1}`} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {token && <EnquiryForm token={token} puppies={puppies} />}
      </div>
    </div>
  )
}

// ── Customer enquiry form ────────────────────────────────────────
// Posts directly to api/create-showcase-enquiry.js — every real
// validation (required fields, email/phone format, consent, rate
// limiting, resolving WHICH litter/tenant this belongs to from the
// token) happens server-side; this form's own checks are only ever a
// same-page UX convenience, never something a direct API caller could
// rely on skipping.
function EnquiryForm({ token, puppies }: { token: string; puppies: PublicPuppy[] }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  // Holds the opaque puppy.id from the public API response (see
  // PublicPuppy above) — never a real Firestore dogId. Sent to the
  // server as `puppyRef`; api/create-showcase-enquiry.js resolves it
  // back to a real dogId itself (see that file's own header comment).
  const [puppyRef, setPuppyRef] = useState('')
  const [consent, setConsent] = useState(false)
  // Honeypot — invisible to a real visitor (off-screen, unreachable by
  // tab order, hidden from screen readers), but present in the DOM for
  // a bot that blindly fills every input on the page. See
  // api/_lib/enquiry-schema.js for how the server treats a non-empty
  // value here.
  const [website, setWebsite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setStatus('idle')
    setErrorMessage('')
    try {
      const res = await fetch('/api/create-showcase-enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, puppyRef: puppyRef || undefined, name, email, phone, message, consent, website }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMessage(data.error || 'Could not send your enquiry — please try again')
        setStatus('error')
        return
      }
      setStatus('sent')
      setName(''); setEmail(''); setPhone(''); setMessage(''); setPuppyRef(''); setConsent(false)
    } catch {
      setErrorMessage('Could not send your enquiry — please check your connection and try again')
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'sent') {
    return (
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Enquiry sent</div>
        <div style={{ fontSize: 13, color: 'var(--mid)' }}>The breeder will be in touch using the details you provided.</div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 14, padding: 18, marginTop: 12 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)', marginBottom: 12 }}>Enquire about this litter</div>

      {puppies.length > 0 && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Which puppy? (optional)</label>
          <select className="form-select" value={puppyRef} onChange={e => setPuppyRef(e.target.value)}>
            <option value="">General enquiry</option>
            {puppies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Your name</label>
        <input className="form-input" value={name} onChange={e => setName(e.target.value)} required maxLength={200} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} />
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input className="form-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={200} />
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Message</label>
        <textarea className="form-input" rows={4} value={message} onChange={e => setMessage(e.target.value)} required maxLength={3000} />
      </div>

      {/* Honeypot field — visually and semantically hidden from real users */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="website">Leave this field blank</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--mid)', cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required style={{ marginTop: 2 }} />
        <span>I consent to the breeder contacting me using the details above.</span>
      </label>

      {status === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{errorMessage}</div>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting || !consent} style={{ width: '100%' }}>
        {submitting ? <span className="spinner" /> : 'Send enquiry'}
      </button>
    </form>
  )
}
