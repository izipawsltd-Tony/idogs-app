import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPrivateDogView, type PrivateDogView } from '../lib/db'

function docLabel(type: string) {
  if (type === 'vaccine_card') return 'Vaccine Card'
  if (type === 'health_test') return 'Health Test'
  if (type === 'pedigree') return 'Pedigree Certificate'
  if (type === 'microchip_cert') return 'Microchip Certificate'
  if (type === 'vet_record') return 'Vet Record'
  return 'Document'
}

export default function PrivateDogPage() {
  const { dogId } = useParams<{ dogId: string }>()
  const [data, setData] = useState<PrivateDogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    if (!dogId) { setError('Private puppy link is invalid.'); setLoading(false); return }
    getPrivateDogView(dogId)
      .then(result => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('This private puppy access is unavailable. Check that you are signed in with the email the breeder shared it with.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dogId])

  if (loading) return <div className="empty-state"><div className="spinner" /></div>
  if (error || !data) return <div className="empty-state"><div className="empty-state-icon">🔒</div><div className="empty-state-title">Private puppy access</div><div className="empty-state-desc">{error}</div></div>
  if (data.ownedByCaller) return (
    <div className="empty-state">
      <div className="empty-state-icon">🐾</div>
      <div className="empty-state-title">{data.dog.name} is now yours</div>
      <div className="empty-state-desc">Ownership has been transferred to your account. Continue in My Dogs to manage the same Dog ID.</div>
      <Link className="btn btn-primary" to={`/app/dogs/${data.dog.id}`} style={{ marginTop: 12 }}>Open {data.dog.name}</Link>
    </div>
  )

  const dog = data.dog
  const photos = dog.photos || []
  const videos = dog.videos || []
  const documents = dog.documents || []
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, color: 'var(--brand-600)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Shared privately with you</div>
        <h1 style={{ margin: '5px 0 4px', fontFamily: 'var(--font-display)', color: 'var(--dark)' }}>{dog.name}</h1>
        <div style={{ color: 'var(--mid)', fontSize: 14 }}>{[dog.breed, dog.sex, dog.colour].filter(Boolean).join(' · ')}</div>
      </div>

      <section style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>Photos &amp; videos</h2>
        {photos.length + videos.length === 0 ? <div style={{ color: 'var(--light)', fontSize: 13 }}>No photos or videos shared yet.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {photos.map(item => <img key={item.id} src={item.url} alt={dog.name} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />)}
            {videos.map(item => <video key={item.id} src={item.url} controls preload="metadata" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />)}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>Documents</h2>
        {documents.length === 0 ? <div style={{ color: 'var(--light)', fontSize: 13 }}>No documents shared yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {documents.map(doc => (
              <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="card" style={{ padding: '12px 14px', textDecoration: 'none', color: 'var(--dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span><strong>{doc.title || docLabel(doc.documentType)}</strong><span style={{ display: 'block', fontSize: 12, color: 'var(--light)', marginTop: 2 }}>{doc.fileType?.toUpperCase() || docLabel(doc.documentType)}</span></span>
                <span style={{ color: 'var(--brand-600)', fontSize: 13 }}>View ↗</span>
              </a>
            ))}
          </div>
        )}
      </section>
      <p style={{ fontSize: 12, color: 'var(--light)', marginTop: 24 }}>This is private pre-transfer access. The breeder remains the current owner until ownership transfer is completed.</p>
    </div>
  )
}
