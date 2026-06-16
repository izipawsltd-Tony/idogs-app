import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAllDocumentsForUser, getDogs } from '../lib/db'
import type { Dog, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function DocumentsPage({ toast }: Props) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<any[]>([])
  const [dogs, setDogs] = useState<Record<string, Dog>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    if (!user) return
    async function load() {
      try {
        const [docs, dogsData] = await Promise.all([
          getAllDocumentsForUser(user!.uid),
          getDogs(),
        ])
        const dogMap: Record<string, Dog> = {}
        dogsData.forEach((d: Dog) => { dogMap[d.id] = d })
        setDocuments(docs)
        setDogs(dogMap)
      } catch {
        toast('Failed to load documents', 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  function getDocIcon(type: string) {
    if (type === 'vaccine_card') return '💉'
    if (type === 'health_test') return '🔬'
    if (type === 'pedigree') return '📜'
    if (type === 'microchip_cert') return '🔖'
    if (type === 'vet_record') return '🏥'
    return '📄'
  }

  function getDocLabel(type: string) {
    if (type === 'vaccine_card') return 'Vaccine Card'
    if (type === 'health_test') return 'Health Test'
    if (type === 'pedigree') return 'Pedigree Certificate'
    if (type === 'microchip_cert') return 'Microchip Certificate'
    if (type === 'vet_record') return 'Vet Record'
    return 'Document'
  }

  const DOC_TYPES = ['all', 'vaccine_card', 'health_test', 'pedigree', 'microchip_cert', 'vet_record', 'other']

  const filtered = documents.filter(d => filter === 'all' || d.documentType === filter)

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 2 }}>Documents</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>{documents.length} document{documents.length !== 1 ? 's' : ''} saved</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {DOC_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: '7px 14px', borderRadius: 20, border: '1.5px solid',
              borderColor: filter === type ? 'var(--green)' : 'var(--border)',
              background: filter === type ? 'var(--green-light)' : 'var(--white)',
              color: filter === type ? 'var(--green)' : 'var(--mid)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            {type === 'all' ? 'All' : getDocLabel(type)}
            {type !== 'all' && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
                ({documents.filter(d => d.documentType === type).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-title">No documents yet</div>
            <div className="empty-state-desc">Open a dog profile → AI Scan tab to photograph and save documents.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((doc, i) => {
            const dog = dogs[doc.dogId]
            const uploadDate = doc.uploadedAt?.toDate?.()?.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
            return (
              <div key={i} style={{
                background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                {/* Icon */}
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: 'var(--green-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.5rem', flexShrink: 0,
                }}>
                  {getDocIcon(doc.documentType)}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)' }}>
                      {getDocLabel(doc.documentType)}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)', fontWeight: 500 }}>
                      {doc.fileType?.toUpperCase()}
                    </span>
                  </div>
                  {dog && (
                    <Link to={`/app/dogs/${doc.dogId}`} style={{ fontSize: 13, color: 'var(--green)', textDecoration: 'none', fontWeight: 500 }}>
                      🐾 {dog.name}
                    </Link>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 2 }}>
                    {uploadDate || 'Recently uploaded'}
                  </div>
                  {doc.extractedData?.vaccines > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
                      💉 {doc.extractedData.vaccines} vaccine(s) extracted
                    </div>
                  )}
                  {doc.extractedData?.healthTest && (
                    <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
                      🔬 {doc.extractedData.healthTest} test extracted
                    </div>
                  )}
                </div>

                {/* View button */}
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                  style={{ flexShrink: 0 }}
                >
                  View ↗
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
