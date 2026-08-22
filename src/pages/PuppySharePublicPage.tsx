import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPuppyShareView, type PuppyShareView } from '../lib/db'
import { formatDate } from '../lib/utils'

type SharedPuppy = PuppyShareView['puppies'][number]

export default function PuppySharePublicPage() {
  const { token } = useParams<{ token: string }>()
  const [puppies, setPuppies] = useState<SharedPuppy[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setUnavailable(false)
    if (!token) { setUnavailable(true); setLoading(false); return }
    getPuppyShareView(token)
      .then(result => { if (!cancelled) setPuppies(result.puppies) })
      .catch(() => { if (!cancelled) setUnavailable(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) return <main style={center}><div className="spinner" aria-label="Loading private puppy updates" /></main>
  if (unavailable || puppies.length === 0) return (
    <main style={center}>
      <div style={{ textAlign: 'center', maxWidth: 430 }}>
        <img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ width: 150, marginBottom: 28 }} />
        <h1 style={{ fontSize: 25 }}>This private link isn&apos;t available</h1>
        <p style={{ color: 'var(--mid)', lineHeight: 1.6 }}>It may be paused, expired, revoked, or replaced with a new link. Please ask the breeder for access.</p>
        <Link className="btn btn-primary" to="/">Go to iDogs</Link>
      </div>
    </main>
  )

  return (
    <main style={{ minHeight: '100vh', background: '#F5F0E8', color: '#1A1917' }}>
      <header style={{ background: 'linear-gradient(135deg,#063D32,#0D6B58)', color: 'white', padding: '22px 20px 52px' }}>
        <div style={{ maxWidth: 1050, margin: 'auto' }}>
          <Link to="/" aria-label="iDogs home"><img src="/03_idogs_reversed_white_transparent.png" alt="iDogs" style={{ width: 132, marginBottom: 26 }} /></Link>
          <div style={{ color: '#BCE7DC', textTransform: 'uppercase', letterSpacing: 2, fontSize: 12, fontWeight: 700 }}>Private puppy updates</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(30px,6vw,48px)', margin: '8px 0 8px' }}>{puppies.length === 1 ? puppies[0].name : 'Your puppy updates'}</h1>
          <p style={{ margin: 0, color: 'rgba(255,255,255,.82)' }}>Photos and videos shared privately by the breeder. No login required.</p>
        </div>
      </header>
      <section aria-label="Shared puppies" style={{ maxWidth: 1050, margin: '-28px auto 0', padding: '0 16px 48px', display: 'grid', gap: 22 }}>
        {puppies.map(puppy => <SharedPuppyCard key={puppy.id} puppy={puppy} />)}
      </section>
    </main>
  )
}

function SharedPuppyCard({ puppy }: { puppy: SharedPuppy }) {
  const media = [
    ...(puppy.photos || []).map(item => ({ ...item, kind: 'photo' as const })),
    ...(puppy.videos || []).map(item => ({ ...item, kind: 'video' as const })),
  ]
  return (
    <article style={{ background: '#fff', border: '1px solid #E1D9CC', borderRadius: 16, padding: '20px', boxShadow: '0 8px 24px rgba(5,54,45,.08)' }}>
      <h2 style={{ margin: 0, color: '#063D32', fontSize: 24 }}>{puppy.name}</h2>
      <p style={{ color: 'var(--mid)', margin: '5px 0 18px' }}>{[puppy.breed, puppy.sex, puppy.colour, puppy.dateOfBirth ? `Born ${formatDate(puppy.dateOfBirth)}` : ''].filter(Boolean).join(' · ')}</p>
      {media.length === 0 ? <p style={{ color: 'var(--light)' }}>No photos or videos have been shared yet. Check back for updates.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
          {media.map(item => item.kind === 'photo'
            ? <a key={`photo-${item.id}`} href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={`${puppy.name} update`} loading="lazy" style={mediaStyle} /></a>
            : <video key={`video-${item.id}`} src={item.url} controls preload="metadata" aria-label={`${puppy.name} video update`} style={mediaStyle} />)}
        </div>
      )}
    </article>
  )
}

const center: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F5F0E8' }
const mediaStyle: React.CSSProperties = { width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 10, border: '1px solid #E1D9CC', display: 'block', background: '#EEE7DB' }
