import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getDogAge } from '../lib/utils'

// Mirrors the exact allowlisted shape api/showcase-public.js returns —
// deliberately its OWN minimal type here, not the full `Dog`/`Litter`
// types, so this file can never accidentally reference a field the
// public endpoint doesn't actually send (private/internal dog fields
// simply do not exist on this shape at all — a typo reaching for one
// would be a compile error, not a silent `undefined`).
interface PublicPuppy {
  id: string
  name: string
  sex: 'male' | 'female'
  breed: string
  colour: string | null
  dateOfBirth: string
  availability: 'available' | 'on_hold' | 'reserved' | 'unavailable'
  profilePhoto: string | null
  photos: string[]
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
              const photo = puppy.profilePhoto || puppy.photos?.[0] || null
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
                      {puppy.photos.map((url, i) => (
                        <img key={i} src={url} alt={`${puppy.name} photo ${i + 1}`} style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
